// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MeshesTreasury.sol";

/**
 * @title FoundationManage - 基金会自动转账管理合约
 * @dev 改进版基金会管理合约，包含安全增强和新功能
 * 
 * 主要功能：
 * 1. 自动转账管理：支持发起方和收款方的多级限额控制
 * 2. 紧急提取到 Treasury 的功能
 * 3. 自动请求补充机制
 * 4. 增强余额监控和告警
 * 5. 合约就绪状态检查
 * 6. 健康检查功能
 * 
 * 资金流向：
 * - Meshes → MeshesTreasury（自动）
 * - MeshesTreasury → FoundationManage（通过 Safe 或自动平衡）
 * - FoundationManage → 收款方（自动转账）
 */
contract FoundationManage is Ownable, ReentrancyGuard, Pausable {
    // ============ 合约地址配置 ============
    IERC20 public meshToken;
    MeshesTreasury public treasury;
    
    // ============ 余额管理 ============
    uint256 public minBalance;
    uint256 public maxBalance;
    
    // ============ 权限控制 ============
    mapping(address => bool) public approvedInitiators;
    mapping(address => bool) public approvedAutoRecipients;
    
    // ============ 限额配置 ============
    struct RecipientAutoLimit {
        uint256 maxPerTx;
        uint256 maxDaily;
        uint256 usedToday;
        uint256 dayIndex;
        bool enabled;
    }
    mapping(address => RecipientAutoLimit) public autoRecipientLimits;
    
    struct AutoLimit {
        uint256 maxPerTx;
        uint256 maxDaily;
        uint256 usedToday;
        uint256 dayIndex;
        bool enabled;
    }
    mapping(address => AutoLimit) public autoLimits;
    
    // ============ 全局限额 ============
    uint256 public globalAutoDailyMax;
    uint256 public globalAutoUsedToday;
    uint256 public globalAutoDayIndex;
    bool public autoGlobalEnabled;
    
    // ============ 自动补充配置 ============
    bool public autoRefillEnabled;
    uint256 public lastRefillRequest;
    uint256 public minRefillInterval = 1 hours;
    
    // ============ 事件定义 ============
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event InitiatorApproved(address indexed initiator, bool approved);
    event AutoRecipientApproved(address indexed recipient, bool approved);
    event MeshTokenUpdated(address indexed meshToken);
    event AutoTransferExecuted(address indexed initiator, address indexed to, uint256 amount, bytes32 reasonId);
    event AutoLimitUpdated(address indexed spender, uint256 maxPerTx, uint256 maxDaily, bool enabled);
    event AutoRecipientLimitUpdated(address indexed recipient, uint256 maxPerTx, uint256 maxDaily, bool enabled);
    event BalanceThresholdUpdated(uint256 minBalance, uint256 maxBalance);
    event LowBalanceWarning(address indexed foundationManage, uint256 currentBalance, uint256 minBalance);
    event HighBalanceWarning(address indexed foundationManage, uint256 currentBalance, uint256 maxBalance);
    
    // ============ 新增事件 ============
    event RefillRequested(address indexed requester, uint256 requestedAmount, uint256 currentBalance);
    event EmergencyWithdraw(address indexed treasury, uint256 amount);
    event AutoRefillConfigUpdated(bool enabled, uint256 minInterval);
    event AutoTransferFailed(address indexed initiator, address indexed recipient, uint256 amount, string reason);

    constructor(address _treasury) {
        require(_treasury != address(0), "FoundationManage: invalid treasury");
        treasury = MeshesTreasury(_treasury);
        meshToken = IERC20(address(0));
    }

    // ============ 配置函数 ============
    
    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "FoundationManage: invalid treasury");
        address old = address(treasury);
        treasury = MeshesTreasury(_newTreasury);
        emit TreasuryUpdated(old, _newTreasury);
    }

    function setMeshToken(address _meshToken) external onlyOwner {
        require(_meshToken != address(0), "FoundationManage: invalid token");
        require(address(meshToken) == address(0), "FoundationManage: token already set");
        meshToken = IERC20(_meshToken);
        emit MeshTokenUpdated(_meshToken);
    }

    function setInitiator(address initiator, bool approved) external onlyOwner {
        approvedInitiators[initiator] = approved;
        emit InitiatorApproved(initiator, approved);
    }

    function setInitiators(address[] calldata initiators, bool approved) external onlyOwner {
        for (uint256 i = 0; i < initiators.length; i++) {
            approvedInitiators[initiators[i]] = approved;
            emit InitiatorApproved(initiators[i], approved);
        }
    }

    function setAutoRecipient(address to, bool approved) external onlyOwner {
        approvedAutoRecipients[to] = approved;
        emit AutoRecipientApproved(to, approved);
    }

    function setAutoRecipients(address[] calldata recipients, bool approved) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            approvedAutoRecipients[recipients[i]] = approved;
            emit AutoRecipientApproved(recipients[i], approved);
        }
    }

    function setAutoLimit(address spender, uint256 maxPerTx, uint256 maxDaily, bool enabled) external onlyOwner {
        AutoLimit storage lim = autoLimits[spender];
        lim.maxPerTx = maxPerTx;
        lim.maxDaily = maxDaily;
        lim.enabled = enabled;
        emit AutoLimitUpdated(spender, maxPerTx, maxDaily, enabled);
    }

    function setGlobalAutoDailyMax(uint256 maxAmount) external onlyOwner {
        globalAutoDailyMax = maxAmount;
    }

    function setGlobalAutoEnabled(bool enabled) external onlyOwner {
        autoGlobalEnabled = enabled;
    }

    function setBalanceThresholds(uint256 _minBalance, uint256 _maxBalance) external onlyOwner {
        require(_maxBalance >= _minBalance, "FoundationManage: max must >= min");
        minBalance = _minBalance;
        maxBalance = _maxBalance;
        emit BalanceThresholdUpdated(_minBalance, _maxBalance);
    }

    function setAutoRecipientLimit(address to, uint256 maxPerTx, uint256 maxDaily, bool enabled) external onlyOwner {
        RecipientAutoLimit storage rlim = autoRecipientLimits[to];
        rlim.maxPerTx = maxPerTx;
        rlim.maxDaily = maxDaily;
        rlim.enabled = enabled;
        emit AutoRecipientLimitUpdated(to, maxPerTx, maxDaily, enabled);
    }

    /**
     * @dev 设置自动补充配置（仅限 Owner）
     * @param _enabled 是否启用自动补充
     * @param _minInterval 最小补充间隔
     */
    function setAutoRefillConfig(bool _enabled, uint256 _minInterval) external onlyOwner {
        autoRefillEnabled = _enabled;
        minRefillInterval = _minInterval;
        emit AutoRefillConfigUpdated(_enabled, _minInterval);
    }

    // ============ 查询接口 ============
    
    function isInitiatorApproved(address spender) external view returns (bool) {
        return approvedInitiators[spender];
    }

    function isAutoRecipientApproved(address to) external view returns (bool) {
        return approvedAutoRecipients[to];
    }

    function getAvailableAutoLimit(address initiator) external view returns (uint256) {
        AutoLimit storage lim = autoLimits[initiator];
        if (!lim.enabled) return 0;
        
        uint256 day = block.timestamp / 1 days;
        uint256 usedToday = (lim.dayIndex == day) ? lim.usedToday : 0;
        
        if (lim.maxDaily > usedToday) {
            return lim.maxDaily - usedToday;
        }
        return 0;
    }

    function getAvailableGlobalLimit() external view returns (uint256) {
        if (!autoGlobalEnabled || globalAutoDailyMax == 0) return 0;
        
        uint256 day = block.timestamp / 1 days;
        uint256 usedToday = (globalAutoDayIndex == day) ? globalAutoUsedToday : 0;
        
        if (globalAutoDailyMax > usedToday) {
            return globalAutoDailyMax - usedToday;
        }
        return 0;
    }

    function checkBalanceStatus() external view returns (bool isLow, bool isHigh, uint256 currentBalance) {
        currentBalance = meshToken.balanceOf(address(this));
        isLow = minBalance > 0 && currentBalance < minBalance;
        isHigh = maxBalance > 0 && currentBalance > maxBalance;
    }

    /**
     * @dev 检查合约是否已完全初始化
     */
    function isReady() external view returns (bool) {
        return address(meshToken) != address(0)
            && address(treasury) != address(0)
            && minBalance > 0
            && maxBalance > 0;
    }

    /**
     * @dev 综合健康检查
     */
    function healthCheck() external view returns (
        bool isInitialized,
        bool hasSufficientBalance,
        bool whitelistConfigured,
        bool limitsConfigured,
        string memory status
    ) {
        isInitialized = address(meshToken) != address(0) && address(treasury) != address(0);
        
        uint256 balance = meshToken.balanceOf(address(this));
        hasSufficientBalance = balance >= minBalance;
        
        whitelistConfigured = treasury.isRecipientApproved(address(this));
        
        limitsConfigured = globalAutoDailyMax > 0 && autoGlobalEnabled;
        
        if (!isInitialized) {
            status = "NOT_INITIALIZED";
        } else if (!hasSufficientBalance) {
            status = "LOW_BALANCE";
        } else if (!whitelistConfigured) {
            status = "WHITELIST_ISSUE";
        } else if (!limitsConfigured) {
            status = "LIMITS_NOT_SET";
        } else {
            status = "HEALTHY";
        }
    }

    // ============ 自动转账功能 ============
    
    function autoTransferTo(address to, uint256 amount) external nonReentrant whenNotPaused {
        require(to != address(0), "FoundationManage: invalid to");
        require(amount > 0, "FoundationManage: zero amount");
        require(approvedAutoRecipients[to], "FoundationManage: auto recipient not approved");
        require(autoGlobalEnabled, "FoundationManage: auto disabled");
        require(approvedInitiators[msg.sender], "FoundationManage: initiator not approved");
        
        AutoLimit storage lim = autoLimits[msg.sender];
        require(lim.enabled, "FoundationManage: auto limit disabled");
        require(amount <= lim.maxPerTx, "FoundationManage: exceeds per-tx limit");
        
        uint256 day = block.timestamp / 1 days;
        if (lim.dayIndex != day) {
            lim.dayIndex = day;
            lim.usedToday = 0;
        }
        require(lim.usedToday + amount <= lim.maxDaily, "FoundationManage: exceeds daily limit");
        
        RecipientAutoLimit storage rlim = autoRecipientLimits[to];
        require(rlim.enabled, "FoundationManage: auto recipient limit disabled");
        require(amount <= rlim.maxPerTx, "FoundationManage: recipient per-tx limit");
        
        if (rlim.dayIndex != day) {
            rlim.dayIndex = day;
            rlim.usedToday = 0;
        }
        require(rlim.usedToday + amount <= rlim.maxDaily, "FoundationManage: recipient daily limit");
        
        if (globalAutoDayIndex != day) {
            globalAutoDayIndex = day;
            globalAutoUsedToday = 0;
        }
        require(globalAutoDailyMax > 0, "FoundationManage: global daily max not set");
        require(globalAutoUsedToday + amount <= globalAutoDailyMax, "FoundationManage: exceeds global daily limit");
        
        require(meshToken.balanceOf(address(this)) >= amount, "FoundationManage: insufficient balance");
        
        lim.usedToday += amount;
        rlim.usedToday += amount;
        globalAutoUsedToday += amount;
        
        require(meshToken.transfer(to, amount), "ERC20 transfer failed");
        
        uint256 currentBalance = meshToken.balanceOf(address(this));
        _checkAndEmitBalanceStatus(currentBalance);
        
        // 检查是否需要自动请求补充
        if (autoRefillEnabled && currentBalance < minBalance) {
            _tryRequestRefill();
        }
        
        emit AutoTransferExecuted(msg.sender, to, amount, bytes32(0));
    }

    function autoTransferToWithReason(address to, uint256 amount, bytes32 reasonId) external nonReentrant whenNotPaused {
        require(to != address(0), "FoundationManage: invalid to");
        require(amount > 0, "FoundationManage: zero amount");
        require(approvedAutoRecipients[to], "FoundationManage: auto recipient not approved");
        require(autoGlobalEnabled, "FoundationManage: auto disabled");
        require(approvedInitiators[msg.sender], "FoundationManage: initiator not approved");
        
        AutoLimit storage lim = autoLimits[msg.sender];
        require(lim.enabled, "FoundationManage: auto limit disabled");
        require(amount <= lim.maxPerTx, "FoundationManage: exceeds per-tx limit");
        
        uint256 day = block.timestamp / 1 days;
        if (lim.dayIndex != day) {
            lim.dayIndex = day;
            lim.usedToday = 0;
        }
        require(lim.usedToday + amount <= lim.maxDaily, "FoundationManage: exceeds daily limit");
        
        RecipientAutoLimit storage rlim = autoRecipientLimits[to];
        require(rlim.enabled, "FoundationManage: auto recipient limit disabled");
        require(amount <= rlim.maxPerTx, "FoundationManage: recipient per-tx limit");
        
        if (rlim.dayIndex != day) {
            rlim.dayIndex = day;
            rlim.usedToday = 0;
        }
        require(rlim.usedToday + amount <= rlim.maxDaily, "FoundationManage: recipient daily limit");
        
        if (globalAutoDayIndex != day) {
            globalAutoDayIndex = day;
            globalAutoUsedToday = 0;
        }
        require(globalAutoDailyMax > 0, "FoundationManage: global daily max not set");
        require(globalAutoUsedToday + amount <= globalAutoDailyMax, "FoundationManage: exceeds global daily limit");
        
        require(meshToken.balanceOf(address(this)) >= amount, "FoundationManage: insufficient balance");
        
        lim.usedToday += amount;
        rlim.usedToday += amount;
        globalAutoUsedToday += amount;
        
        require(meshToken.transfer(to, amount), "ERC20 transfer failed");
        
        uint256 currentBalance = meshToken.balanceOf(address(this));
        _checkAndEmitBalanceStatus(currentBalance);
        
        // 检查是否需要自动请求补充
        if (autoRefillEnabled && currentBalance < minBalance) {
            _tryRequestRefill();
        }
        
        emit AutoTransferExecuted(msg.sender, to, amount, reasonId);
    }

    // ============ 自动补充机制 ============
    
    /**
     * @dev 请求从 Treasury 补充资金
     * @param requestedAmount 请求金额（0表示自动计算）
     */
    function requestRefill(uint256 requestedAmount) external nonReentrant whenNotPaused {
        uint256 currentBalance = meshToken.balanceOf(address(this));
        require(currentBalance < minBalance, "FoundationManage: balance sufficient");
        require(
            block.timestamp >= lastRefillRequest + minRefillInterval,
            "FoundationManage: refill interval not met"
        );
        
        // 如果未指定金额，自动计算补充到 maxBalance
        uint256 amount = requestedAmount;
        if (amount == 0) {
            amount = maxBalance - currentBalance;
        }
        
        require(amount > 0, "FoundationManage: zero amount");
        
        lastRefillRequest = block.timestamp;
        emit RefillRequested(msg.sender, amount, currentBalance);
        
        // 如果 Treasury 启用了自动平衡，尝试触发
        if (treasury.autoBalanceEnabled()) {
            try treasury.balanceFoundationManage() {
                // 平衡成功
            } catch {
                // 平衡失败，只记录事件
            }
        }
    }

    /**
     * @dev 内部函数：尝试请求补充
     */
    function _tryRequestRefill() private {
        if (block.timestamp >= lastRefillRequest + minRefillInterval) {
            uint256 currentBalance = meshToken.balanceOf(address(this));
            uint256 amount = maxBalance - currentBalance;
            
            lastRefillRequest = block.timestamp;
            emit RefillRequested(address(this), amount, currentBalance);
            
            if (treasury.autoBalanceEnabled()) {
                try treasury.balanceFoundationManage() {
                    // 平衡成功
                } catch {
                    // 平衡失败，继续执行
                }
            }
        }
    }

    // ============ 紧急提取机制 ============
    
    /**
     * @dev 紧急提取到 Treasury（仅限 Treasury 合约调用，且合约必须处于暂停状态）
     * @param amount 提取金额（0 表示全部）
     */
    function emergencyWithdrawToTreasury(uint256 amount) external nonReentrant whenPaused {
        require(msg.sender == address(treasury), "FoundationManage: only treasury");
        
        uint256 balance = meshToken.balanceOf(address(this));
        require(balance > 0, "FoundationManage: no balance");
        
        uint256 withdrawAmount = amount == 0 ? balance : amount;
        require(withdrawAmount <= balance, "FoundationManage: insufficient balance");
        
        require(meshToken.transfer(address(treasury), withdrawAmount), "ERC20 transfer failed");
        
        emit EmergencyWithdraw(address(treasury), withdrawAmount);
    }

    // ============ 其他功能 ============
    
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _checkAndEmitBalanceStatus(uint256 currentBalance) private {
        if (minBalance > 0 && currentBalance < minBalance) {
            emit LowBalanceWarning(address(this), currentBalance, minBalance);
        }
        if (maxBalance > 0 && currentBalance > maxBalance) {
            emit HighBalanceWarning(address(this), currentBalance, maxBalance);
        }
    }
}
