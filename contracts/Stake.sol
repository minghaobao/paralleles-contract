// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title IFoundationManage - 基金会管理接口
 * @dev 用于从基金会合约转移代币到质押合约
 */
interface IFoundationManage {
    function autoTransferTo(address to, uint256 amount) external;
}

/**
 * @title Stake - 质押合约
 * @dev 管理用户代币质押和利息计算，支持固定期限质押
 * 
 * 核心功能：
 * 1. 质押代币：用户质押代币获得利息
 * 2. 利息计算：基于APY和质押期限计算利息
 * 3. 提取本金：质押到期后可提取本金和利息
 * 4. 自动补充：当余额不足时自动从基金会补充
 * 
 * 质押机制：
 * - 固定期限：用户选择质押天数
 * - 线性APY：利息按时间线性增长
 * - 到期提取：只有到期后才能提取本金
 * - 提前提取：可以提前提取，但只能获得部分利息
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 访问控制：关键功能仅限治理地址
 * - 余额检查：确保有足够的代币进行分发
 * - 时间验证：确保质押期限合理
 * 
 * @author Parallels Team
 * @notice 本合约实现了固定期限的代币质押系统
 */
contract Stake is ReentrancyGuard, Pausable {
    /**
     * @dev 用户质押信息结构体
     * @param term 质押天数
     * @param maturityTs 到期时间戳
     * @param amount 质押金额
     * @param startTime 开始时间戳
     * @param lastClaimTime 最后领取时间
     */
    struct StakeInfo {
        uint256 term;           // 质押天数
        uint256 maturityTs;     // 到期时间戳
        uint256 amount;         // 质押金额
        uint256 startTime;      // 开始时间戳
        uint256 lastClaimTime;  // 最后领取时间
    }
    
    /**
     * @dev 质押统计信息结构体
     * @param totalStaked 总质押数量
     * @param totalEarned 总收益数量
     * @param activeStakes 活跃质押数量
     * @param totalStakers 总质押者数量
     */
    struct StakeStats {
        uint256 totalStaked;    // 总质押数量
        uint256 totalEarned;    // 总收益数量
        uint256 activeStakes;   // 活跃质押数量
        uint256 totalStakers;   // 总质押者数量
    }

    // ============ 合约地址配置 ============
    /** @dev Mesh代币合约地址 */
    IERC20 public meshToken;
    
    /** @dev 基金会地址，用于接收剩余代币 */
    address public foundationAddr;
    
    /** @dev 基金会管理合约地址，用于代币转移 */
    address public foundationManager;
    
    /** @dev 治理安全地址（Gnosis Safe），用于管理操作 */
    address public governanceSafe;
    
    // ============ 质押参数配置 ============
    /** @dev 年化收益率（基点，如1000表示10%） */
    uint256 public apy;
    
    /** @dev 一天的秒数常量 */
    uint256 public constant SECONDS_IN_DAY = 86400;
    
    /** @dev APY基数，10000 = 100% */
    uint256 public constant APY_BASE = 10000;
    
    /** @dev 最低合约余额，低于该值则触发申请 */
    uint256 public minContractBalance;
    
    // ============ 质押和提取限额 ============
    /** @dev 最小质押金额 */
    uint256 public minStakeAmount;
    
    /** @dev 最大质押金额 */
    uint256 public maxStakeAmount;
    
    mapping(address => StakeInfo) public userStakes;
    mapping(address => uint256) public userTotalEarned;
    mapping(address => uint256) public userTotalStaked;
    mapping(address => bool) public hasStaked; // 追踪用户是否曾经质押过
    
    StakeStats public stakeStats;
    
    // 旧 owners 多签已移除
    
    // 质押相关事件
    event Staked(address indexed user, uint256 amount, uint256 term, uint256 maturityTs);
    event Withdrawn(address indexed user, uint256 amount, uint256 reward);
    event InterestClaimed(address indexed user, uint256 amount, uint256 timestamp);
    event APYUpdated(uint256 oldAPY, uint256 newAPY);
    event FoundationUpdated(address indexed oldFoundation, address indexed newFoundation);
    event FoundationManagerUpdated(address indexed oldManager, address indexed newManager);
    event MinContractBalanceUpdated(uint256 oldValue, uint256 newValue);
    event AutoTopUpRequested(address indexed manager, uint256 requestedAmount);
    event StakeLimitsUpdated(uint256 minAmount, uint256 maxAmount);
    
    // 仅 Safe 可执行管理操作
    modifier onlySafe() {
        require(msg.sender == governanceSafe, "Only Safe");
        _;
    }
    
    modifier onlyFoundation() {
        require(msg.sender == foundationAddr, "Only foundation can call");
        _;
    }
    
    modifier hasStake() {
        require(userStakes[msg.sender].amount > 0, "No active stake");
        _;
    }
    
    constructor(
        address _meshToken,
        address _foundationAddr,
        address _governanceSafe,
        uint256 _apy
    ) {
        require(_meshToken != address(0), "Invalid mesh token address");
        require(_foundationAddr != address(0), "Invalid foundation address");
        require(_governanceSafe != address(0), "Invalid safe address");
        require(_apy > 0, "APY must be greater than 0");
        
        meshToken = IERC20(_meshToken);
        foundationAddr = _foundationAddr;
        apy = _apy;
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
    
    /**
     * @dev 质押代币
     * @param _amount 质押金额
     * @param _term 质押天数
     */
    function stake(uint256 _amount, uint256 _term) external nonReentrant whenNotPaused {
        require(_amount > 0, "Amount must be greater than 0");
        
        // 检查质押限额
        if (minStakeAmount > 0) {
            require(_amount >= minStakeAmount, "Below minimum stake amount");
        }
        if (maxStakeAmount > 0) {
            require(_amount <= maxStakeAmount, "Exceeds maximum stake amount");
        }
        
        require(_term >= 1, "Term must be at least 1 day");
        require(_term <= 365, "Term cannot exceed 1 year");
        require(userStakes[msg.sender].amount == 0, "Active stake already exists");
        require(meshToken.balanceOf(msg.sender) >= _amount, "Insufficient balance");
        
        // 转移代币到合约
        require(
            meshToken.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );
        
        // 创建质押记录
        uint256 maturityTs = block.timestamp + (_term * SECONDS_IN_DAY);
        userStakes[msg.sender] = StakeInfo({
            term: _term,
            maturityTs: maturityTs,
            amount: _amount,
            startTime: block.timestamp,
            lastClaimTime: block.timestamp
        });
        
        // 更新统计信息
        userTotalStaked[msg.sender] += _amount;
        stakeStats.totalStaked += _amount;
        stakeStats.activeStakes++;
        
        // 只在用户首次质押时增加 totalStakers
        if (!hasStaked[msg.sender]) {
            hasStaked[msg.sender] = true;
            stakeStats.totalStakers++;
        }
        
        emit Staked(msg.sender, _amount, _term, maturityTs);
    }
    
    /**
     * @dev 提取质押本金和利息
     */
    function withdraw() external nonReentrant whenNotPaused hasStake {
        StakeInfo storage userStake = userStakes[msg.sender];
        require(block.timestamp >= userStake.maturityTs, "Stake not matured yet");
        
        uint256 principal = userStake.amount;
        uint256 interest = calculateInterest(msg.sender);
        uint256 totalAmount = principal + interest;
        _ensureTopUp(totalAmount);
        
        // 更新统计信息
        stakeStats.totalStaked -= principal;
        stakeStats.totalEarned += interest;
        stakeStats.activeStakes--;
        
        // 从合约余额支付（本金+利息）
        require(meshToken.transfer(msg.sender, totalAmount), "Transfer failed");
        
        // 更新用户统计
        userTotalEarned[msg.sender] += interest;
        
        emit Withdrawn(msg.sender, principal, interest);
        
        // 清除质押记录
        delete userStakes[msg.sender];
    }
    
    /**
     * @dev 提前解除质押（需要支付手续费）
     */
    function earlyWithdraw() external nonReentrant whenNotPaused hasStake {
        StakeInfo storage userStake = userStakes[msg.sender];
        require(block.timestamp < userStake.maturityTs, "Stake already matured");
        
        uint256 principal = userStake.amount;
        uint256 interest = calculateInterest(msg.sender);
        
        // 提前解除质押的手续费：损失50%的利息
        uint256 penalty = interest / 2;
        uint256 totalAmount = principal + (interest - penalty);
        _ensureTopUp(totalAmount);
        
        // 更新统计信息
        stakeStats.totalStaked -= principal;
        stakeStats.totalEarned += (interest - penalty);
        stakeStats.activeStakes--;
        
        // 从合约余额支付（本金+利息-罚金）
        require(meshToken.transfer(msg.sender, totalAmount), "Transfer failed");
        
        // 更新用户统计
        userTotalEarned[msg.sender] += (interest - penalty);
        
        emit Withdrawn(msg.sender, principal, interest - penalty);
        
        // 清除质押记录
        delete userStakes[msg.sender];
    }
    
    /**
     * @dev 领取利息（不解除质押）
     */
    function claimInterest() external nonReentrant whenNotPaused hasStake {
        StakeInfo storage userStake = userStakes[msg.sender];
        uint256 interest = calculateInterest(msg.sender);
        require(interest > 0, "No interest to claim");
        _ensureTopUp(interest);
        
        // 更新最后领取时间
        userStake.lastClaimTime = block.timestamp;
        
        // 从合约余额支付利息
        require(meshToken.transfer(msg.sender, interest), "Transfer failed");
        
        // 更新统计信息
        stakeStats.totalEarned += interest;
        userTotalEarned[msg.sender] += interest;
        
        emit InterestClaimed(msg.sender, interest, block.timestamp);
    }
    
    /**
     * @dev 计算用户应得利息
     * @param _user 用户地址
     * @return 利息金额
     */
    function calculateInterest(address _user) public view returns (uint256) {
        StakeInfo memory userStake = userStakes[_user];
        if (userStake.amount == 0) {
            return 0;
        }
        
        uint256 timeElapsed = block.timestamp - userStake.lastClaimTime;
        if (timeElapsed == 0) {
            return 0;
        }
        
        // 计算利息：本金 * APY * 时间 / (365天 * APY基数)
        uint256 interest = (userStake.amount * apy * timeElapsed) / (365 * SECONDS_IN_DAY * APY_BASE);
        
        return interest;
    }
    
    /**
     * @dev 获取用户质押信息
     * @param _user 用户地址
     */
    function getStakeInfo(address _user) external view returns (
        uint256 term,
        uint256 maturityTs,
        uint256 amount,
        uint256 startTime,
        uint256 lastClaimTime,
        uint256 currentInterest,
        uint256 totalEarned,
        bool isMatured
    ) {
        StakeInfo memory stake = userStakes[_user];
        term = stake.term;
        maturityTs = stake.maturityTs;
        amount = stake.amount;
        startTime = stake.startTime;
        lastClaimTime = stake.lastClaimTime;
        currentInterest = calculateInterest(_user);
        totalEarned = userTotalEarned[_user];
        isMatured = block.timestamp >= maturityTs;
    }
    
    /**
     * @dev 获取质押统计信息
     */
    function getStakeStats() external view returns (
        uint256 totalStaked,
        uint256 totalEarned,
        uint256 activeStakes,
        uint256 totalStakers,
        uint256 currentAPY
    ) {
        totalStaked = stakeStats.totalStaked;
        totalEarned = stakeStats.totalEarned;
        activeStakes = stakeStats.activeStakes;
        totalStakers = stakeStats.totalStakers;
        currentAPY = apy;
    }
    
    /**
     * @dev 更新APY（仅限所有者）
     * @param _newAPY 新的年化收益率
     */
    function updateAPY(uint256 _newAPY) external onlySafe {
        require(_newAPY > 0, "APY must be greater than 0");
        require(_newAPY <= 10000, "APY cannot exceed 100%");
        
        uint256 oldAPY = apy;
        apy = _newAPY;
        
        emit APYUpdated(oldAPY, _newAPY);
    }
    
    /**
     * @dev 更新基金会地址（仅限所有者）
     * @param _newFoundation 新的基金会地址
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

    function setMinContractBalance(uint256 _min) external onlySafe {
        emit MinContractBalanceUpdated(minContractBalance, _min);
        minContractBalance = _min;
    }

    /**
     * @dev 设置质押限额（仅限 Safe）
     * @param _minAmount 最小质押金额（0 表示无限制）
     * @param _maxAmount 最大质押金额（0 表示无限制）
     */
    function setStakeLimits(uint256 _minAmount, uint256 _maxAmount) external onlySafe {
        if (_minAmount > 0 && _maxAmount > 0) {
            require(_maxAmount >= _minAmount, "Max must be >= min");
        }
        minStakeAmount = _minAmount;
        maxStakeAmount = _maxAmount;
        emit StakeLimitsUpdated(_minAmount, _maxAmount);
    }

    /**
     * @dev 暂停合约（仅限 Safe）
     */
    function pause() external onlySafe {
        _pause();
    }

    /**
     * @dev 恢复合约（仅限 Safe）
     */
    function unpause() external onlySafe {
        _unpause();
    }

    function _ensureTopUp(uint256 pendingPayout) internal {
        if (foundationManager == address(0)) return;
        uint256 bal = meshToken.balanceOf(address(this));
        if (bal >= minContractBalance && bal >= pendingPayout) return;
        uint256 target = minContractBalance * 2;
        uint256 need = target > bal ? (target - bal) : 0;
        if (need < pendingPayout) {
            need = pendingPayout;
        }
        if (need == 0) return;
        emit AutoTopUpRequested(foundationManager, need);
        // 可选直接尝试调用（由治理预授权时可成功）
        try IFoundationManage(foundationManager).autoTransferTo(address(this), need) {
        } catch {
            // 忽略失败，等待 Safe/Owner 执行
        }
    }
    
    /**
     * @dev 获取用户质押时间
     * @param _user 用户地址
     */
    function getStakeTime(address _user) external view returns (uint256) {
        StakeInfo memory stake = userStakes[_user];
        if (stake.amount == 0) {
            return 0;
        }
        return stake.maturityTs;
    }
    
    /**
     * @dev 检查用户是否有活跃质押
     * @param _user 用户地址
     */
    function hasActiveStake(address _user) external view returns (bool) {
        return userStakes[_user].amount > 0;
    }
    
    /**
     * @dev 获取质押到期时间
     * @param _user 用户地址
     */
    function getMaturityTime(address _user) external view returns (uint256) {
        return userStakes[_user].maturityTs;
    }
    
    /**
     * @dev 获取用户总质押金额
     * @param _user 用户地址
     */
    function getUserTotalStaked(address _user) external view returns (uint256) {
        return userTotalStaked[_user];
    }
    
    /**
     * @dev 获取用户总收益
     * @param _user 用户地址
     */
    function getUserTotalEarned(address _user) external view returns (uint256) {
        return userTotalEarned[_user];
    }
    
    /**
     * @dev 计算质押的TVL（总锁仓价值）
     * @param _price 代币价格（以wei为单位）
     */
    function calculateTVL(uint256 _price) external view returns (uint256) {
        return (stakeStats.totalStaked * _price) / 1e18;
    }
    
    /**
     * @dev 计算质押的收益率
     * @param _user 用户地址
     */
    function calculateStakeAPY(address _user) external view returns (uint256) {
        StakeInfo memory stake = userStakes[_user];
        if (stake.amount == 0) {
            return 0;
        }
        
        uint256 timeElapsed = block.timestamp - stake.startTime;
        if (timeElapsed == 0) {
            return 0;
        }
        
        // 计算实际收益率
        uint256 totalEarned = userTotalEarned[_user] + calculateInterest(_user);
        uint256 apy = (totalEarned * 365 * SECONDS_IN_DAY * APY_BASE) / (stake.amount * timeElapsed);
        
        return apy;
    }
    
    // 旧 owners 多签相关逻辑已移除
}
