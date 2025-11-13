// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MeshesTreasury - 基础国库资金管理合约
 * @dev 管理基金会代币的基础存储，接收来自 Meshes 的代币分配
 * 
 * 核心功能：
 * 1. 代币存储：安全存储基金会的 Mesh 代币（接收来自 Meshes 的自动转账）
 * 2. 权限控制：仅支持 Owner 和 Safe 双重权限
 * 3. 安全转账：所有转账必须通过 Safe 多签执行
 * 4. 自动平衡：支持自动向 FoundationManage 补充资金
 * 
 * 资金流向：
 * - Meshes → Treasury（自动转账，通过 Meshes 合约的 FoundationAddr）
 * - Treasury → FoundationManage（通过 Safe 手动转账或自动平衡）
 * 
 * 权限机制：
 * - Owner权限：合约所有者，初始时可以设置基础配置，可以切换到 Safe 治理模式
 * - Safe权限：Gnosis Safe 多签，可以执行所有转账操作、关键配置和手动平衡
 * - 治理模式切换：一旦切换到 Safe 治理模式，所有关键配置只能由 Safe 执行
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停
 * - 白名单控制：仅允许向白名单地址转账
 * - 访问控制：严格的权限控制
 * 
 * @author Parallels Team
 * @notice 本合约实现了基金会代币的基础安全存储和转账系统
 */
contract MeshesTreasury is Ownable, ReentrancyGuard, Pausable {
    // ============ 合约地址配置 ============
    /** @dev Mesh 代币合约地址 */
    IERC20 public meshToken;
    
    /** @dev 多签 Safe 地址，作为转账权限来源 */
    address public safeAddress;
    
    /** @dev FoundationManage 合约地址，用于余额平衡 */
    address public foundationManage;

    // ============ 权限控制 ============
    /** @dev 收款白名单（允许作为 to 接收转账） */
    mapping(address => bool) public approvedRecipients;
    
    /** @dev 治理模式：true=Safe治理，false=Owner治理 */
    bool public isSafeGovernance = false;
    
    /** @dev 治理模式切换锁定：一旦切换到Safe模式，无法回退到Owner模式 */
    bool public governanceLocked = false;

    // ============ 事件定义 ============
    /** @dev Safe 地址更新事件：当 Safe 地址变更时触发 */
    event SafeUpdated(address indexed oldSafe, address indexed newSafe);
    
    /** @dev 收款方批准事件：当收款方被批准或取消批准时触发 */
    event RecipientApproved(address indexed recipient, bool approved);
    
    /** @dev Mesh 代币地址更新事件：当 Mesh 代币地址设置时触发 */
    event MeshTokenUpdated(address indexed meshToken);
    
    /** @dev FoundationManage 地址更新事件：当 FoundationManage 地址变更时触发 */
    event FoundationManageUpdated(address indexed oldFoundationManage, address indexed newFoundationManage);
    
    /** @dev 转账执行事件：记录调用发起者、收款方、金额与原因ID */
    event TransferExecuted(address indexed initiator, address indexed to, uint256 amount, bytes32 reasonId);
    
    /** @dev 余额平衡事件：记录平衡操作的结果 */
    event BalanceBalanced(address indexed foundationManage, uint256 treasuryBalance, uint256 foundationBalance, uint256 transferredAmount);
    
    /** @dev 治理模式切换事件：当治理模式变更时触发 */
    event GovernanceModeSwitched(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);
    
    /** @dev 治理模式锁定事件：当治理模式被锁定时触发 */
    event GovernanceModeLocked(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);

    // 仅限 Safe 执行（用于资金划拨）
    modifier onlySafeExec() {
        require(msg.sender == safeAddress, "MeshesTreasury: only Safe");
        _;
    }
    
    /** @dev 仅限当前治理者调用的修饰符（Owner或Safe） */
    modifier onlyGovernance() {
        if (isSafeGovernance) {
            require(msg.sender == safeAddress, "MeshesTreasury: only Safe governance");
        } else {
            require(msg.sender == owner(), "MeshesTreasury: only Owner governance");
        }
        _;
    }
    
    /** @dev 仅限Owner调用的修饰符（无论治理模式） */
    modifier onlyContractOwner() {
        require(msg.sender == owner(), "MeshesTreasury: only Owner");
        _;
    }

    constructor(address _safe) {
        require(_safe != address(0), "MeshesTreasury: invalid safe");
        safeAddress = _safe;
        // meshToken 初始化为 address(0)，后续通过 setMeshToken 设置
        meshToken = IERC20(address(0));
    }

    /**
     * @dev 设置 Safe 地址（仅限治理者）
     * @param _newSafe 新的 Safe 地址
     * 
     * 功能说明：
     * - 设置 Gnosis Safe 多签钱包地址
     * - 这是最关键的权限控制，必须通过治理者（Owner 或 Safe）授权
     * - 如果已切换到 Safe 治理模式，只能由 Safe 调用
     */
    function setSafe(address _newSafe) external onlyGovernance whenNotPaused {
        require(_newSafe != address(0), "MeshesTreasury: invalid safe");
        require(_newSafe != safeAddress, "MeshesTreasury: same safe address");
        address old = safeAddress;
        safeAddress = _newSafe;
        emit SafeUpdated(old, _newSafe);
    }

    /**
     * @dev 设置 Mesh 代币地址（仅限治理者，且只能设置一次）
     * @param _meshToken Mesh 代币合约地址
     * 
     * 功能说明：
     * - 设置 Mesh 代币合约地址
     * - 只能设置一次，防止意外修改
     * - 用于解决部署时的循环依赖问题
     * - 这是关键配置，必须通过治理者授权
     */
    function setMeshToken(address _meshToken) external onlyGovernance whenNotPaused {
        require(_meshToken != address(0), "MeshesTreasury: invalid token");
        require(address(meshToken) == address(0), "MeshesTreasury: token already set");
        meshToken = IERC20(_meshToken);
        emit MeshTokenUpdated(_meshToken);
    }

    /**
     * @dev 设置 FoundationManage 地址（仅限 Safe）
     * @param _foundationManage FoundationManage 合约地址
     * 
     * 功能说明：
     * - 设置 FoundationManage 合约地址
     * - 这是关键配置，影响资金流向，必须通过 Safe 多签授权
     * - 设置后需要将 FoundationManage 添加到收款白名单
     */
    function setFoundationManage(address _foundationManage) external onlySafeExec whenNotPaused {
        require(_foundationManage != address(0), "MeshesTreasury: invalid foundation manage");
        require(_foundationManage != foundationManage, "MeshesTreasury: same foundation manage");
        address old = foundationManage;
        foundationManage = _foundationManage;
        emit FoundationManageUpdated(old, _foundationManage);
    }

    /**
     * @dev 设置收款白名单（仅限 Safe）
     * @param to 收款地址
     * @param approved 是否批准
     * 
     * 功能说明：
     * - 设置收款地址的白名单状态
     * - 这是关键安全控制，影响资金流向，必须通过 Safe 多签授权
     * - 只有白名单中的地址才能接收 Treasury 的转账
     */
    function setRecipient(address to, bool approved) external onlySafeExec whenNotPaused {
        require(to != address(0), "MeshesTreasury: invalid recipient");
        approvedRecipients[to] = approved;
        emit RecipientApproved(to, approved);
    }

    /**
     * @dev 批量设置收款白名单（仅限 Safe）
     * @param recipients 收款地址数组
     * @param approved 是否批准
     * 
     * 功能说明：
     * - 批量设置收款地址的白名单状态
     * - 这是关键安全控制，必须通过 Safe 多签授权
     */
    function setRecipients(address[] calldata recipients, bool approved) external onlySafeExec whenNotPaused {
        require(recipients.length > 0, "MeshesTreasury: empty array");
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "MeshesTreasury: invalid recipient");
            approvedRecipients[recipients[i]] = approved;
            emit RecipientApproved(recipients[i], approved);
        }
    }

    /**
     * @dev 查询收款地址是否在白名单中
     * @param to 收款地址
     * @return 是否在白名单中
     */
    function isRecipientApproved(address to) external view returns (bool) {
        return approvedRecipients[to];
    }

    /**
     * @dev 基础转账功能（仅限 Safe 执行）
     * @param to 收款地址
     * @param amount 转账金额
     * 
     * 功能说明：
     * - 仅 Safe 多签可以调用
     * - 收款地址必须在白名单中
     * - 支持暂停机制
     * - 防止重入攻击
     */
    function transferTo(address to, uint256 amount) external onlySafeExec nonReentrant whenNotPaused {
        require(to != address(0), "MeshesTreasury: invalid to");
        require(amount > 0, "MeshesTreasury: zero amount");
        require(meshToken.balanceOf(address(this)) >= amount, "MeshesTreasury: insufficient");
        require(approvedRecipients[to], "MeshesTreasury: recipient not approved");
        require(meshToken.transfer(to, amount), "ERC20 transfer failed");
        emit TransferExecuted(msg.sender, to, amount, bytes32(0));
    }

    /**
     * @dev 带原因ID的转账（仅限 Safe 执行）
     * @param to 收款地址
     * @param amount 转账金额
     * @param reasonId 转账原因ID（用于审计追踪）
     */
    function transferToWithReason(address to, uint256 amount, bytes32 reasonId) external onlySafeExec nonReentrant whenNotPaused {
        require(to != address(0), "MeshesTreasury: invalid to");
        require(amount > 0, "MeshesTreasury: zero amount");
        require(approvedRecipients[to], "MeshesTreasury: recipient not approved");
        require(meshToken.balanceOf(address(this)) >= amount, "MeshesTreasury: insufficient");
        require(meshToken.transfer(to, amount), "ERC20 transfer failed");
        emit TransferExecuted(msg.sender, to, amount, reasonId);
    }

    /**
     * @dev 暂停合约（仅限 Safe 执行）
     */
    function pause() external onlySafeExec {
        _pause();
    }

    /**
     * @dev 恢复合约（仅限 Safe 执行）
     */
    function unpause() external onlySafeExec {
        _unpause();
    }

    /**
     * @dev 紧急从 FoundationManage 提取资金（仅限 Safe 执行）
     * @param amount 提取金额（0 表示提取全部）
     * 
     * 功能说明：
     * - 紧急情况下，Safe 可以从 FoundationManage 提取资金回 Treasury
     * - 用于应对 FoundationManage 被攻击或配置错误的情况
     * - 需要 FoundationManage 预先授权 Treasury 可以提取资金
     * 
     * 注意：此功能需要 FoundationManage 实现相应的授权机制
     */
    function emergencyWithdrawFromFoundation(uint256 amount) external onlySafeExec nonReentrant whenNotPaused {
        require(foundationManage != address(0), "MeshesTreasury: foundation manage not set");
        
        uint256 foundationBalance = meshToken.balanceOf(foundationManage);
        require(foundationBalance > 0, "MeshesTreasury: foundation has no balance");
        
        uint256 withdrawAmount = amount == 0 ? foundationBalance : amount;
        require(withdrawAmount <= foundationBalance, "MeshesTreasury: insufficient foundation balance");
        
        // 注意：这需要 FoundationManage 实现紧急提取函数
        // 调用 FoundationManage 的 emergencyWithdrawToTreasury 函数
        (bool success, ) = foundationManage.call(
            abi.encodeWithSignature("emergencyWithdrawToTreasury(uint256)", withdrawAmount)
        );
        require(success, "Emergency withdraw failed");
        
        emit TransferExecuted(msg.sender, foundationManage, withdrawAmount, bytes32("EMERGENCY_WITHDRAW"));
    }

    /**
     * @dev 获取合约余额
     * @return 合约持有的 Mesh 代币余额
     */
    function balance() external view returns (uint256) {
        return meshToken.balanceOf(address(this));
    }

    /** @dev 是否启用自动平衡功能 */
    bool public autoBalanceEnabled;
    
    /** @dev 自动平衡的最小差额阈值，低于此值不执行平衡 */
    uint256 public autoBalanceThreshold;
    
    /** @dev 上次执行平衡的时间戳 */
    uint256 public lastBalanceTimestamp;
    
    /** @dev 自动平衡的最小时间间隔（防止滥用） */
    uint256 public minBalanceInterval = 1 hours;
    
    /** @dev Treasury 和 Foundation 的余额比例（1-100，表示 Treasury 占总余额的百分比） */
    uint256 public balanceRatio = 50; // 默认 50:50
    
    /** @dev 自动平衡事件 */
    event AutoBalanceEnabledUpdated(bool enabled);
    event AutoBalanceThresholdUpdated(uint256 threshold);
    event MinBalanceIntervalUpdated(uint256 interval);
    event BalanceRatioUpdated(uint256 ratio);

    /**
     * @dev 设置自动平衡功能（仅限 Safe）
     * @param _enabled 是否启用
     * @param _threshold 最小差额阈值
     * @param _ratio Treasury 和 Foundation 的余额比例（1-100，表示 Treasury 占总余额的百分比）
     * 
     * 功能说明：
     * - 配置自动平衡参数，影响资金自动分配
     * - 这是关键配置，必须通过 Safe 多签授权
     * 
     * 比例说明：
     * - 50: Treasury 和 Foundation 各占 50%（默认）
     * - 70: Treasury 占 70%，Foundation 占 30%
     * - 30: Treasury 占 30%，Foundation 占 70%
     */
    function setAutoBalance(bool _enabled, uint256 _threshold, uint256 _ratio) external onlySafeExec whenNotPaused {
        require(_ratio >= 1 && _ratio <= 100, "MeshesTreasury: ratio must be 1-100");
        
        autoBalanceEnabled = _enabled;
        autoBalanceThreshold = _threshold;
        balanceRatio = _ratio;
        
        emit AutoBalanceEnabledUpdated(_enabled);
        emit AutoBalanceThresholdUpdated(_threshold);
        emit BalanceRatioUpdated(_ratio);
    }

    /**
     * @dev 设置最小平衡间隔（仅限 Safe）
     * @param _interval 最小时间间隔（秒）
     * 
     * 功能说明：
     * - 设置自动平衡的最小时间间隔
     * - 这是关键配置，必须通过 Safe 多签授权
     */
    function setMinBalanceInterval(uint256 _interval) external onlySafeExec whenNotPaused {
        require(_interval >= 10 minutes, "MeshesTreasury: interval too short");
        require(_interval <= 7 days, "MeshesTreasury: interval too long");
        minBalanceInterval = _interval;
        emit MinBalanceIntervalUpdated(_interval);
    }

    /**
     * @dev 平衡 Treasury 和 FoundationManage 的 MESH 余额
     * @dev 根据设定的比例调整余额，使 Treasury 和 FoundationManage 的余额符合设定的比例
     * 
     * 功能说明：
     * - Safe 多签可以调用（手动平衡）
     * - 如果启用自动平衡，任何人都可以调用（自动平衡）
     * - 计算 Treasury 和 FoundationManage 的总余额
     * - 根据 balanceRatio 计算目标余额
     * - 如果 Treasury 余额大于目标，则转账差额到 FoundationManage
     * - 如果 FoundationManage 余额大于目标，则不执行转账（只允许从 Treasury 向 FoundationManage 转账）
     * - 确保 FoundationManage 在收款白名单中
     * 
     * 算法：
     * - totalBalance = treasuryBalance + foundationBalance
     * - targetTreasuryBalance = totalBalance * balanceRatio / 100
     * - targetFoundationBalance = totalBalance * (100 - balanceRatio) / 100
     * - 如果 treasuryBalance > targetTreasuryBalance：
     *   - transferAmount = treasuryBalance - targetTreasuryBalance
     *   - 转账后：treasuryBalance' ≈ targetTreasuryBalance, foundationBalance' ≈ targetFoundationBalance
     */
    function balanceFoundationManage() external nonReentrant whenNotPaused {
        // 权限检查：Safe 可以随时调用，其他人需要启用自动平衡并满足时间间隔
        if (msg.sender != safeAddress) {
            require(autoBalanceEnabled, "MeshesTreasury: auto balance disabled");
            require(
                block.timestamp >= lastBalanceTimestamp + minBalanceInterval,
                "MeshesTreasury: balance interval not met"
            );
        }
        
        require(foundationManage != address(0), "MeshesTreasury: foundation manage not set");
        require(approvedRecipients[foundationManage], "MeshesTreasury: foundation manage not approved");
        
        uint256 treasuryBalance = meshToken.balanceOf(address(this));
        uint256 foundationBalance = meshToken.balanceOf(foundationManage);
        uint256 totalBalance = treasuryBalance + foundationBalance;
        
        // 计算目标余额：Treasury 应该占总余额的 balanceRatio%
        uint256 targetTreasuryBalance = (totalBalance * balanceRatio) / 100;
        
        // 如果 Treasury 余额已经小于等于目标余额，不需要转账
        if (treasuryBalance <= targetTreasuryBalance) {
            emit BalanceBalanced(foundationManage, treasuryBalance, foundationBalance, 0);
            return;
        }
        
        // 计算需要转账的金额
        uint256 transferAmount = treasuryBalance - targetTreasuryBalance;
        
        // 检查是否达到自动平衡阈值
        if (msg.sender != safeAddress && transferAmount < autoBalanceThreshold) {
            emit BalanceBalanced(foundationManage, treasuryBalance, foundationBalance, 0);
            return;
        }
        
        // 如果转账金额为0，不需要转账
        if (transferAmount == 0) {
            emit BalanceBalanced(foundationManage, treasuryBalance, foundationBalance, 0);
            return;
        }
        
        // 检查 Treasury 余额是否足够
        require(treasuryBalance >= transferAmount, "MeshesTreasury: insufficient balance");
        
        // 执行转账
        require(meshToken.transfer(foundationManage, transferAmount), "ERC20 transfer failed");
        
        // 更新时间戳
        lastBalanceTimestamp = block.timestamp;
        
        // 获取转账后的余额
        uint256 newTreasuryBalance = meshToken.balanceOf(address(this));
        uint256 newFoundationBalance = meshToken.balanceOf(foundationManage);
        
        emit BalanceBalanced(foundationManage, newTreasuryBalance, newFoundationBalance, transferAmount);
    }

    /**
     * @dev 查询 Treasury 和 FoundationManage 的余额信息（供外部查询）
     * @return treasuryBalance Treasury 余额
     * @return foundationBalance FoundationManage 余额
     * @return difference 余额差（Treasury - FoundationManage）
     */
    function getBalanceInfo() external view returns (
        uint256 treasuryBalance,
        uint256 foundationBalance,
        uint256 difference
    ) {
        treasuryBalance = meshToken.balanceOf(address(this));
        if (foundationManage != address(0)) {
            foundationBalance = meshToken.balanceOf(foundationManage);
            if (treasuryBalance > foundationBalance) {
                difference = treasuryBalance - foundationBalance;
            } else {
                difference = 0;
            }
        } else {
            foundationBalance = 0;
            difference = 0;
        }
    }
    
    /**
     * @dev 切换到Safe治理模式（仅限Owner，且只能切换一次）
     * 
     * 功能说明：
     * - 将治理权限从Owner切换到Safe
     * - 一旦切换，无法回退到Owner模式
     * - 确保治理的去中心化和安全性
     * 
     * 安全特性：
     * - 仅限Owner调用
     * - 只能切换一次，防止重复切换
     * - 暂停时不可调用
     * - 事件记录：便于追踪治理模式变更
     */
    function switchToSafeGovernance() external onlyContractOwner whenNotPaused {
        require(!governanceLocked, "MeshesTreasury: governance already locked");
        require(safeAddress != address(0), "MeshesTreasury: safe address not set");
        require(!isSafeGovernance, "MeshesTreasury: already in Safe governance");
        
        isSafeGovernance = true;
        governanceLocked = true;
        
        emit GovernanceModeSwitched(true, msg.sender, block.timestamp);
        emit GovernanceModeLocked(true, msg.sender, block.timestamp);
    }
    
    /**
     * @dev 获取当前治理信息
     * @return _isSafeGovernance 是否为Safe治理模式
     * @return _governanceLocked 治理模式是否已锁定
     * @return _currentGovernance 当前治理者地址
     */
    function getGovernanceInfo() external view returns (
        bool _isSafeGovernance,
        bool _governanceLocked,
        address _currentGovernance
    ) {
        _isSafeGovernance = isSafeGovernance;
        _governanceLocked = governanceLocked;
        _currentGovernance = isSafeGovernance ? safeAddress : owner();
    }
}

