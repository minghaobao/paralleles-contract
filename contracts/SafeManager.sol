// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SafeManager - Gnosis Safe多签钱包管理合约
 * @dev 管理Gnosis Safe多签钱包的集成，提供操作提议和执行机制
 * 
 * 核心功能：
 * 1. 操作提议：提议需要多签批准的操作
 * 2. 操作执行：执行已批准的操作
 * 3. 状态跟踪：跟踪操作的状态和执行情况
 * 4. 权限管理：管理Safe地址和操作权限
 * 
 * 操作类型：
 * - MESH_CLAIM：网格认领操作
 * - MESH_WITHDRAW：网格收益提取操作
 * - REWARD_SET：设置奖励操作
 * - REWARD_WITHDRAW：提取奖励操作
 * - STAKE：质押操作
 * - STAKE_WITHDRAW：质押提取操作
 * - EMERGENCY_PAUSE：紧急暂停操作
 * - EMERGENCY_RESUME：紧急恢复操作
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停
 * - 访问控制：仅限Owner和Safe调用
 * - 操作验证：确保操作的有效性
 * 
 * @author Parallels Team
 * @notice 本合约实现了Gnosis Safe多签钱包的集成管理
 */
contract SafeManager is Ownable, ReentrancyGuard, Pausable {
    
    // ============ 合约地址配置 ============
    /** @dev Gnosis Safe多签钱包地址 */
    address public safeAddress;
    
    /** @dev 可信任执行者地址（如 AutomatedExecutor 或 Automation Safe） */
    mapping(address => bool) public trustedExecutors;
    
    // ============ 操作类型枚举 ============
    /**
     * @dev 操作类型枚举，定义支持的所有操作类型
     */
    enum OperationType {
        MESH_CLAIM,      // 网格认领操作
        MESH_WITHDRAW,   // 网格收益提取操作
        REWARD_SET,      // 设置奖励操作
        REWARD_WITHDRAW, // 提取奖励操作
        STAKE,           // 质押操作
        STAKE_WITHDRAW,  // 质押提取操作
        EMERGENCY_PAUSE, // 紧急暂停操作
        EMERGENCY_RESUME // 紧急恢复操作
    }
    
    // ============ 操作状态结构体 ============
    /**
     * @dev 操作状态结构体，记录操作的详细信息
     * @param opType 操作类型
     * @param target 目标合约地址
     * @param data 操作数据
     * @param timestamp 操作时间戳
     * @param executed 是否已执行
     * @param description 操作描述
     */
    struct Operation {
        OperationType opType;    // 操作类型
        address target;          // 目标合约地址
        bytes data;              // 操作数据
        uint256 timestamp;       // 操作时间戳
        bool executed;           // 是否已执行
        string description;      // 操作描述
    }
    
    // ============ 操作管理 ============
    /** @dev 操作映射：操作ID => 操作信息 */
    mapping(bytes32 => Operation) public operations;
    
    /** @dev 操作计数器，用于生成唯一操作ID */
    uint256 public operationCount;
    
    // 事件
    event SafeAddressUpdated(address indexed oldSafe, address indexed newSafe);
    event TrustedExecutorUpdated(address indexed executor, bool trusted);
    event OperationProposed(
        bytes32 indexed operationId,
        OperationType opType,
        address target,
        string description
    );
    event OperationExecuted(bytes32 indexed operationId);
    event OperationCancelled(bytes32 indexed operationId);
    
    // 修饰符
    modifier onlySafe() {
        require(msg.sender == safeAddress || trustedExecutors[msg.sender], "SafeManager: Only Safe or trusted executor can call");
        _;
    }
    
    modifier operationExists(bytes32 operationId) {
        require(operations[operationId].timestamp > 0, "SafeManager: Operation does not exist");
        _;
    }
    
    modifier operationNotExecuted(bytes32 operationId) {
        require(!operations[operationId].executed, "SafeManager: Operation already executed");
        _;
    }
    
    constructor(address _safeAddress) {
        require(_safeAddress != address(0), "SafeManager: Invalid Safe address");
        safeAddress = _safeAddress;
    }
    
    /**
     * @dev 更新Safe地址（仅限所有者）
     */
    function updateSafeAddress(address _newSafeAddress) external onlyOwner {
        require(_newSafeAddress != address(0), "SafeManager: Invalid Safe address");
        require(_newSafeAddress != safeAddress, "SafeManager: Same Safe address");
        
        address oldSafe = safeAddress;
        safeAddress = _newSafeAddress;
        
        emit SafeAddressUpdated(oldSafe, _newSafeAddress);
    }
    
    /**
     * @dev 设置可信任执行者（仅限Safe）
     * @notice 允许 Safe 自己通过 Safe App 触发 executeOperation，或添加 AutomatedExecutor/Automation Safe
     * @param _executor 执行者地址
     * @param _trusted 是否信任
     */
    function setTrustedExecutor(address _executor, bool _trusted) external onlySafe {
        require(_executor != address(0), "SafeManager: Invalid executor address");
        trustedExecutors[_executor] = _trusted;
        emit TrustedExecutorUpdated(_executor, _trusted);
    }
    
    /**
     * @dev 提议操作（仅限Safe）
     */
    function proposeOperation(
        OperationType _opType,
        address _target,
        bytes calldata _data,
        string calldata _description
    ) external onlySafe returns (bytes32) {
        require(_target != address(0), "SafeManager: Invalid target address");
        
        bytes32 operationId = keccak256(
            abi.encodePacked(
                _opType,
                _target,
                _data,
                block.timestamp,
                operationCount
            )
        );
        
        operations[operationId] = Operation({
            opType: _opType,
            target: _target,
            data: _data,
            timestamp: block.timestamp,
            executed: false,
            description: _description
        });
        
        operationCount++;
        
        emit OperationProposed(operationId, _opType, _target, _description);
        
        return operationId;
    }
    
    /**
     * @dev 执行操作（仅限Safe）
     */
    function executeOperation(bytes32 _operationId) 
        external 
        onlySafe 
        operationExists(_operationId) 
        operationNotExecuted(_operationId)
        nonReentrant 
        returns (bool success, bytes memory returnData) 
    {
        Operation storage operation = operations[_operationId];
        
        // 执行操作
        (success, returnData) = operation.target.call(operation.data);
        
        if (success) {
            operation.executed = true;
            emit OperationExecuted(_operationId);
        }
        
        return (success, returnData);
    }
    
    /**
     * @dev 取消操作（仅限Safe）
     */
    function cancelOperation(bytes32 _operationId) 
        external 
        onlySafe 
        operationExists(_operationId) 
        operationNotExecuted(_operationId) 
    {
        delete operations[_operationId];
        emit OperationCancelled(_operationId);
    }
    
    /**
     * @dev 获取操作信息
     */
}
