// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ICheckInVerifier - 签到验证接口
 * @dev 用于验证用户是否满足特定活动的签到条件
 */
interface ICheckInVerifier {
    function isEligible(uint256 activityId, address user) external view returns (bool);
}

/**
 * @title IFoundationManage - 基金会管理接口
 * @dev 用于从基金会合约转移代币到奖励合约
 */
interface IFoundationManage {
    function autoTransferTo(address to, uint256 amount) external;
}

/**
 * @title Reward - 奖励分发合约
 * @dev 管理用户奖励的分配和提取，支持活动奖励和基础奖励
 * 
 * 核心功能：
 * 1. 奖励设置：治理地址可以设置用户奖励
 * 2. 奖励提取：用户可以从基金会提取奖励
 * 3. 活动奖励：支持基于活动的奖励分发
 * 4. 自动补充：当余额不足时自动从基金会补充
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停
 * - 访问控制：关键功能仅限治理地址
 * - 余额检查：确保有足够的代币进行分发
 * 
 * @author Parallels Team
 * @notice 本合约实现了基于活动的奖励分发系统
 */
contract Reward is ReentrancyGuard, Pausable {
    /**
     * @dev 用户奖励信息结构体
     * @param totalAmount 总奖励数量
     * @param withdrawnAmount 已提取数量
     * @param lastWithdrawTime 最后提取时间戳
     */
    struct RewardInfo {
        uint256 totalAmount;        // 用户总奖励数量
        uint256 withdrawnAmount;    // 已提取的奖励数量
        uint256 lastWithdrawTime;   // 最后提取时间戳
    }

    // ============ 合约地址配置 ============
    /** @dev Mesh代币合约地址 */
    IERC20 public meshToken;
    
    /** @dev 基金会地址（废弃路径，统一托管后不再作为提现来源） */
    address public foundationAddr;
    
    /** @dev 基金会管理合约地址，用于代币转移 */
    address public foundationManager;
    
    /** @dev 签到验证合约地址，用于验证用户资格 */
    ICheckInVerifier public checkInVerifier;
    
    /** @dev 治理安全地址（Gnosis Safe），用于管理操作 */
    address public governanceSafe;
    
    // ============ 用户数据映射 ============
    /** @dev 用户奖励信息：用户地址 => 奖励信息 */
    mapping(address => RewardInfo) public userRewards;
    
    // ============ 统计信息 ============
    /** @dev 总分发奖励数量 */
    uint256 public totalRewardsDistributed;
    
    /** @dev 总提取奖励数量 */
    uint256 public totalRewardsWithdrawn;
    
    // ============ 提取限额 ============
    /** @dev 最小提取金额 */
    uint256 public minWithdrawAmount;
    
    /** @dev 最大单次提取金额 */
    uint256 public maxWithdrawAmount;
    
    // 取消日限额与内部签名机制
    
    // ============ 事件定义 ============
    /** @dev 奖励设置事件：当为用户设置奖励时触发 */
    event RewardSet(address indexed user, uint256 amount, uint256 timestamp);
    
    /** @dev 奖励提取事件：当用户提取奖励时触发 */
    event RewardWithdrawn(address indexed user, uint256 amount, uint256 timestamp);
    
    /** @dev 基金会地址更新事件：当基金会地址变更时触发 */
    event FoundationUpdated(address indexed oldFoundation, address indexed newFoundation);
    
    /** @dev 基金会管理合约更新事件：当管理合约地址变更时触发 */
    event FoundationManagerUpdated(address indexed oldManager, address indexed newManager);
    
    /** @dev 签到验证合约更新事件：当验证合约地址变更时触发 */
    event CheckInVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    
    /** @dev 活动奖励事件：当用户获得活动奖励时触发 */
    event ActivityRewarded(uint256 indexed activityId, address indexed user, uint256 amount);
    
    /** @dev 批量活动奖励事件：当批量分发活动奖励时触发 */
    event ActivityBatchRewarded(uint256 indexed activityId, uint256 count, uint256 totalAmount);
    
    /** @dev 提取限额更新事件 */
    event WithdrawLimitsUpdated(uint256 minAmount, uint256 maxAmount);
    
    modifier onlySafe() {
        require(msg.sender == governanceSafe, "Only Safe");
        _;
    }

    modifier onlyFoundation() {
        require(msg.sender == foundationAddr, "Only foundation can call");
        _;
    }
    
    constructor(
        address _meshToken,
        address _foundationAddr,
        address _governanceSafe
    ) {
        require(_meshToken != address(0), "Invalid mesh token address");
        require(_foundationAddr != address(0), "Invalid foundation address");
        require(_governanceSafe != address(0), "Invalid safe address");
        meshToken = IERC20(_meshToken);
        foundationAddr = _foundationAddr;
        governanceSafe = _governanceSafe;
    }
    
    /**
     * @dev 设置/更新治理 Safe 地址（由旧多签所有者发起一次性迁移）
     */
    function setGovernanceSafe(address _safe) external onlySafe {
        require(_safe != address(0), "Invalid safe");
        require(_safe != governanceSafe, "Same safe");
        governanceSafe = _safe;
    }
    
    // 仅限 Safe：紧急暂停/恢复
    function pause() external onlySafe { _pause(); }
    function unpause() external onlySafe { _unpause(); }
    
    /**
     * @dev 设置提取限额（由 Safe 执行）
     * @param _minAmount 最小提取金额（0 表示无限制）
     * @param _maxAmount 最大单次提取金额（0 表示无限制）
     */
    function setWithdrawLimits(uint256 _minAmount, uint256 _maxAmount) external onlySafe {
        if (_minAmount > 0 && _maxAmount > 0) {
            require(_maxAmount >= _minAmount, "Max must be >= min");
        }
        minWithdrawAmount = _minAmount;
        maxWithdrawAmount = _maxAmount;
        emit WithdrawLimitsUpdated(_minAmount, _maxAmount);
    }
    
    /**
     * @dev 设置用户奖励（由 Safe 执行）
     * @param _users 用户地址数组
     * @param _amounts 对应的奖励金额数组
     * @param _totalAmount 总奖励金额（用于一致性检查）
     */
    function setUserReward(
        address[] calldata _users,
        uint256[] calldata _amounts,
        uint256 _totalAmount
    ) external onlySafe whenNotPaused {
        require(_users.length == _amounts.length, "Array length mismatch");
        require(_users.length > 0, "Empty arrays");
        
        uint256 calculatedTotal = 0;
        for (uint256 i = 0; i < _users.length; i++) {
            require(_users[i] != address(0), "Invalid user address");
            require(_amounts[i] > 0, "Invalid amount");
            
            userRewards[_users[i]].totalAmount += _amounts[i];
            calculatedTotal += _amounts[i];
            
            emit RewardSet(_users[i], _amounts[i], block.timestamp);
        }
        
        require(calculatedTotal == _totalAmount, "Total amount mismatch");
        totalRewardsDistributed += _totalAmount;
    }

    /**
     * @dev 单个激励：针对活动成功者发放奖励（需验证 eligibility）
     */
    function rewardActivityWinner(
        uint256 activityId,
        address user,
        uint256 amount
    ) external onlySafe whenNotPaused {
        require(user != address(0) && amount > 0, "Invalid params");
        require(address(checkInVerifier) != address(0), "Verifier not set");
        require(checkInVerifier.isEligible(activityId, user), "Not eligible");

        userRewards[user].totalAmount += amount;
        totalRewardsDistributed += amount;
        emit ActivityRewarded(activityId, user, amount);

        _ensureTopUp(amount);
    }

    /**
     * @dev 批次激励：对一批活动成功者发放奖励
     */
    function rewardActivityWinnersBatch(
        uint256 activityId,
        address[] calldata users,
        uint256[] calldata amounts
    ) external onlySafe {
        require(users.length == amounts.length && users.length > 0, "Invalid arrays");
        require(address(checkInVerifier) != address(0), "Verifier not set");
        uint256 total;
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            uint256 a = amounts[i];
            require(u != address(0) && a > 0, "Invalid item");
            require(checkInVerifier.isEligible(activityId, u), "Not eligible");
            userRewards[u].totalAmount += a;
            total += a;
        }
        totalRewardsDistributed += total;
        emit ActivityBatchRewarded(activityId, users.length, total);
        _ensureTopUp(total);
    }
    
    /**
     * @dev 获取用户奖励信息
     * @param _user 用户地址
     * @return totalAmount 总奖励金额
     * @return withdrawnAmount 已提取金额
     * @return availableAmount 可提取金额
     * @return lastWithdrawTime 最后提取时间
     */
    function getRewardAmount(address _user) 
        external 
        view 
        returns (
            uint256 totalAmount,
            uint256 withdrawnAmount,
            uint256 availableAmount,
            uint256 lastWithdrawTime
        ) 
    {
        RewardInfo memory reward = userRewards[_user];
        totalAmount = reward.totalAmount;
        withdrawnAmount = reward.withdrawnAmount;
        availableAmount = reward.totalAmount - reward.withdrawnAmount;
        lastWithdrawTime = reward.lastWithdrawTime;
    }
    
    /**
     * @dev 用户提取奖励
     * @param _amount 提取金额
     */
    function withdraw(uint256 _amount) external nonReentrant whenNotPaused {
        require(_amount > 0, "Amount must be greater than 0");
        
        // 检查提取限额
        if (minWithdrawAmount > 0) {
            require(_amount >= minWithdrawAmount, "Below minimum withdraw amount");
        }
        if (maxWithdrawAmount > 0) {
            require(_amount <= maxWithdrawAmount, "Exceeds maximum withdraw amount");
        }
        
        RewardInfo storage reward = userRewards[msg.sender];
        require(reward.totalAmount > reward.withdrawnAmount, "No rewards available");
        
        uint256 availableAmount = reward.totalAmount - reward.withdrawnAmount;
        require(_amount <= availableAmount, "Insufficient available rewards");
        // 直接由 Reward 自持余额发放
        // 若余额不足，将由前置流程通过 FoundationManage 进行补仓
        require(meshToken.balanceOf(address(this)) >= _amount, "Insufficient buffer");
        require(meshToken.transfer(msg.sender, _amount), "Transfer failed");
        
        // 更新状态
        reward.withdrawnAmount += _amount;
        reward.lastWithdrawTime = block.timestamp;
        totalRewardsWithdrawn += _amount;
        
        emit RewardWithdrawn(msg.sender, _amount, block.timestamp);
    }
    
    /**
     * @dev 批量提取奖励（一次性提取所有可用奖励）
     */
    function withdrawAll() external nonReentrant whenNotPaused {
        RewardInfo storage reward = userRewards[msg.sender];
        require(reward.totalAmount > reward.withdrawnAmount, "No rewards available");
        uint256 withdrawAmount = reward.totalAmount - reward.withdrawnAmount;
        // 直接由 Reward 自持余额发放
        require(meshToken.balanceOf(address(this)) >= withdrawAmount, "Insufficient buffer");
        require(meshToken.transfer(msg.sender, withdrawAmount), "Transfer failed");
        
        // 更新状态
        reward.withdrawnAmount += withdrawAmount;
        reward.lastWithdrawTime = block.timestamp;
        totalRewardsWithdrawn += withdrawAmount;
        
        emit RewardWithdrawn(msg.sender, withdrawAmount, block.timestamp);
    }
    
    /**
     * @dev 更新基金会地址（仅限所有者）
     */
    function updateFoundation(address _newFoundation) external onlySafe {
        require(_newFoundation != address(0), "Invalid foundation address");
        require(_newFoundation != foundationAddr, "Same foundation address");
        
        address oldFoundation = foundationAddr;
        foundationAddr = _newFoundation;
        
        emit FoundationUpdated(oldFoundation, _newFoundation);
    }

    function setFoundationManager(address _manager) external onlySafe {
        require(_manager != address(0), "Invalid manager");
        address old = foundationManager;
        foundationManager = _manager;
        emit FoundationManagerUpdated(old, _manager);
    }

    function setCheckInVerifier(address _verifier) external onlySafe {
        require(_verifier != address(0), "Invalid verifier");
        address old = address(checkInVerifier);
        checkInVerifier = ICheckInVerifier(_verifier);
        emit CheckInVerifierUpdated(old, _verifier);
    }
    
    /**
     * @dev 获取合约统计信息
     */
    function getContractStats() external view returns (
        uint256 _totalRewardsDistributed,
        uint256 _totalRewardsWithdrawn,
        uint256 _pendingRewards,
        address _safe
    ) {
        _totalRewardsDistributed = totalRewardsDistributed;
        _totalRewardsWithdrawn = totalRewardsWithdrawn;
        _pendingRewards = totalRewardsDistributed - totalRewardsWithdrawn;
        _safe = governanceSafe;
    }
    
    /**
     * @dev 获取用户列表（用于管理）
     */
    function getUsersWithRewards(uint256 /*_startIndex*/, uint256 /*_endIndex*/) 
        external 
        pure 
        returns (address[] memory users, uint256[] memory amounts) 
    {
        // 简化：不在链上分页枚举，返回空数组以鼓励 Off-chain 统计
        users = new address[](0);
        amounts = new uint256[](0);
    }


    // ============ 内部：余额不足时自动向 FoundationManage 申请补充 =========
    uint256 public minFoundationBalance; // 低于该值则触发申请
    event MinFoundationBalanceUpdated(uint256 oldValue, uint256 newValue);
    event AutoTopUpRequested(address indexed manager, uint256 requestedAmount);

    function setMinFoundationBalance(uint256 _min) external onlySafe {
        emit MinFoundationBalanceUpdated(minFoundationBalance, _min);
        minFoundationBalance = _min;
    }

    function _ensureTopUp(uint256 pendingNewRewards) internal {
        if (foundationManager == address(0)) return;
        uint256 bal = meshToken.balanceOf(address(this));
        if (bal >= minFoundationBalance) return;
        // 估算请求量：目标补至 minFoundationBalance 的 2 倍，至少覆盖 pendingNewRewards
        uint256 target = minFoundationBalance * 2;
        uint256 need = target > bal ? (target - bal) : 0;
        if (need < pendingNewRewards) {
            need = pendingNewRewards;
        }
        if (need == 0) return;
        emit AutoTopUpRequested(foundationManager, need);
        try IFoundationManage(foundationManager).autoTransferTo(address(this), need) {
        } catch {
        }
    }
}
