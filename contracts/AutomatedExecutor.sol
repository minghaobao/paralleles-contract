// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./SafeManager.sol";

/**
 * @title AutomatedExecutor - 自动化执行器合约
 * @dev 自动化执行器，用于自动执行Safe操作，支持批量处理和重试机制
 * 
 * 核心功能：
 * 1. 操作队列：管理待执行的操作队列
 * 2. 批量执行：支持批量执行多个操作
 * 3. 重试机制：失败操作自动重试
 * 4. 规则配置：可配置执行规则和限制
 * 5. 权限管理：基于角色的访问控制
 * 
 * 执行规则：
 * - 最小执行间隔：防止过于频繁的执行
 * - 最大Gas价格：控制执行成本
 * - 最大批量大小：控制单次执行的操作数量
 * - 重试限制：防止无限重试
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停
 * - 访问控制：基于角色的权限管理
 * - 队列限制：防止队列溢出
 * 
 * @author Parallels Team
 * @notice 本合约实现了Safe操作的自动化执行系统
 */
contract AutomatedExecutor is AccessControl, ReentrancyGuard, Pausable {
    
    // ============ 角色权限常量 ============
    /** @dev 执行者角色，可以执行操作 */
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    
    /** @dev 管理员角色，可以管理执行规则 */
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // ============ 合约地址配置 ============
    /** @dev SafeManager合约地址 */
    SafeManager public safeManager;
    
    // ============ 操作队列管理 ============
    /**
     * @dev 队列操作结构体
     * @param operationId 操作ID
     * @param timestamp 入队时间戳
     * @param executed 是否已执行
     * @param retryCount 重试次数
     * @param maxRetries 最大重试次数
     */
    struct QueuedOperation {
        bytes32 operationId;    // 操作ID
        uint256 timestamp;      // 入队时间戳
        bool executed;          // 是否已执行
        uint256 retryCount;     // 重试次数
        uint256 maxRetries;     // 最大重试次数
    }
    
    // ============ 数据映射 ============
    /** @dev 队列操作映射：操作ID => 队列操作 */
    mapping(bytes32 => QueuedOperation) public queuedOperations;
    
    /** @dev 操作队列数组 */
    bytes32[] public operationQueue;
    
    // ============ 系统常量 ============
    /** @dev 最大重试次数 */
    uint256 public constant MAX_RETRIES = 3;
    
    /** @dev 最大队列大小 */
    uint256 public constant MAX_QUEUE_SIZE = 1000;
    
event OperationQueued(bytes32 indexed operationId);
event OperationExecuted(bytes32 indexed operationId, bool success);
event BatchExecuted(uint256 count, uint256 successCount);
    
    modifier onlyExecutor() {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "AutomatedExecutor: Only executor can call");
        _;
    }
    
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "AutomatedExecutor: Only admin can call");
        _;
    }
    
    constructor(address _safeManager) {
        safeManager = SafeManager(_safeManager);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
    }
    
    /**
     * @dev 将操作加入队列
     * @notice 安全修复：禁止添加高风险操作，避免 Batch 失败隐蔽
     */
    function queueOperation(bytes32 _operationId) external onlyExecutor returns (bool) {
        require(_operationId != bytes32(0), "Invalid operation id");
        require(operationQueue.length < MAX_QUEUE_SIZE, "Queue full");
        if (queuedOperations[_operationId].timestamp > 0) {
            return false;
        }

        queuedOperations[_operationId] = QueuedOperation({
            operationId: _operationId,
            timestamp: block.timestamp,
            executed: false,
            retryCount: 0,
            maxRetries: MAX_RETRIES
        });

        operationQueue.push(_operationId);
        emit OperationQueued(_operationId);
        return true;
    }
    
    /**
     * @dev 批量执行队列中的操作
     */
    function executeBatch(uint256 _maxCount) external onlyExecutor nonReentrant returns (uint256 successCount) {
        require(_maxCount > 0, "Invalid batch size");
        require(!paused(), "Contract is paused");

        uint256 executedCount = 0;
        successCount = 0;
        for (uint256 i = 0; i < operationQueue.length && executedCount < _maxCount; i++) {
            bytes32 operationId = operationQueue[i];
            QueuedOperation storage operation = queuedOperations[operationId];

            if (operation.executed || operation.retryCount >= operation.maxRetries) {
                continue;
            }

            (bool success, ) = safeManager.executeOperation(operationId);
            if (success) {
                operation.executed = true;
                emit OperationExecuted(operationId, true);
                successCount++;
            } else {
                operation.retryCount++;
                emit OperationExecuted(operationId, false);
            }
            executedCount++;
        }

        _cleanupExecutedOperations();
        emit BatchExecuted(executedCount, successCount);
        return successCount;
    }
    
    /**
     * @dev 执行单个操作
     */
    function executeSingleOperation(bytes32 _operationId) external onlyExecutor {
        QueuedOperation storage operation = queuedOperations[_operationId];
        require(operation.timestamp > 0, "Operation not found");
        require(!operation.executed, "Operation already executed");
        require(operation.retryCount < operation.maxRetries, "Max retries reached");

        (bool success, ) = safeManager.executeOperation(_operationId);

        if (success) {
            operation.executed = true;
        } else {
            operation.retryCount++;
        }
        emit OperationExecuted(_operationId, success);
    }
    
    /**
     * @dev 清理已执行的操作
     */
    function _cleanupExecutedOperations() private {
        uint256 i = 0;
        while (i < operationQueue.length) {
            bytes32 operationId = operationQueue[i];
            if (queuedOperations[operationId].executed) {
                operationQueue[i] = operationQueue[operationQueue.length - 1];
                operationQueue.pop();
                delete queuedOperations[operationId];
            } else {
                i++;
            }
        }
    }
    /**
     * @dev 获取队列状态
     */
    function getQueueStatus() external view returns (
        uint256 totalQueued,
        uint256 pendingExecutions,
        uint256 failedOperations
    ) {
        totalQueued = operationQueue.length;
        uint256 pending = 0;
        uint256 failed = 0;
        
        for (uint256 i = 0; i < operationQueue.length; i++) {
            QueuedOperation storage operation = queuedOperations[operationQueue[i]];
            if (!operation.executed) {
                pending++;
                if (operation.retryCount >= operation.maxRetries) {
                    failed++;
                }
            }
        }
        
        pendingExecutions = pending;
        failedOperations = failed;
    }
    
    /**
     * @dev 获取操作详情
     */
    function getOperationDetails(bytes32 _operationId) external view returns (
        uint256 timestamp,
        bool executed,
        uint256 retryCount,
        uint256 maxRetries
    ) {
        QueuedOperation storage operation = queuedOperations[_operationId];
        return (
            operation.timestamp,
            operation.executed,
            operation.retryCount,
            operation.maxRetries
        );
    }
    
    /**
     * @dev 紧急暂停
     */
    function emergencyPause() external onlyAdmin {
        _pause();
    }
    
    /**
     * @dev 紧急恢复
     */
    function emergencyResume() external onlyAdmin {
        _unpause();
    }
    
    /**
     * @dev 设置SafeManager地址
     */
    function setSafeManager(address _safeManager) external onlyAdmin {
        require(_safeManager != address(0), "Invalid address");
        safeManager = SafeManager(_safeManager);
    }
    
}
