// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./Meshes.sol";
import "./FoundationManage.sol";

/**
 * @title X402PaymentGateway - X402支付网关合约
 * @dev 集成X402支付协议，实现支付完成后自动分发MESH代币并完成Claim
 * 
 * 核心功能：
 * 1. 接收X402支付回调：验证支付信息并处理
 * 2. 稳定币汇率管理：支持多种稳定币（USDT, USDC, DAI等）
 * 3. 自动MESH分发：根据支付金额自动计算并分发MESH
 * 4. 自动Claim：可选自动完成网格Claim操作
 * 5. 支付记录：记录所有支付交易，支持查询和退款
 * 
 * 支付流程：
 * 1. 用户在前端选择X402支付，选择稳定币和支付金额
 * 2. 支付到平台账户（X402系统处理）
 * 3. X402系统发送支付回调到本合约
 * 4. 合约验证支付签名和金额
 * 5. 根据稳定币类型和汇率计算MESH数量
 * 6. 从FoundationManage合约转账MESH到用户地址
 * 7. 如果提供了网格ID，自动调用ClaimMesh完成Claim
 * 
 * 安全特性：
 * - 签名验证：使用ECDSA验证X402支付回调的合法性
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停
 * - 支付防重放：使用nonce防止重复处理
 * - 汇率保护：设置最小/最大兑换比例
 * 
 * @author Parallels Team
 * @notice 本合约实现了X402支付协议与MESH代币系统的集成
 */
contract X402PaymentGateway is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ============ 合约地址 ============
    /** @dev MESH代币合约地址 */
    IERC20 public meshToken;
    
    /** @dev Meshes合约地址（用于Claim操作） */
    Meshes public meshesContract;
    
    /** @dev FoundationManage合约地址（用于MESH分发） */
    FoundationManage public foundationManage;
    
    /** @dev X402支付系统授权地址（用于验证支付签名） */
    address public x402Verifier;

    // ============ 支付记录 ============
    /**
     * @dev 支付信息结构体
     */
    struct PaymentInfo {
        address user;               // 支付用户地址
        address stablecoinToken;    // 稳定币合约地址（address(0)表示原生币）
        uint256 amount;             // 支付金额（稳定币单位）
        uint256 meshAmount;         // 分发的MESH数量
        string meshID;              // 网格ID（可选，为空则不Claim）
        uint256 timestamp;          // 支付时间戳
        bool claimed;               // 是否已Claim网格
        bool processed;             // 是否已处理
    }
    
    /** @dev 支付记录：支付ID => 支付信息 */
    mapping(bytes32 => PaymentInfo) public payments;
    
    /** @dev 用户支付记录：用户地址 => 支付ID数组 */
    mapping(address => bytes32[]) public userPayments;
    
    /** @dev 支付nonce映射：nonce => 是否已使用（防止重放攻击） */
    mapping(uint256 => bool) public usedNonces;

    // ============ 稳定币配置 ============
    /**
     * @dev 稳定币配置结构体
     */
    struct StablecoinConfig {
        address tokenAddress;      // 稳定币合约地址
        uint256 rate;               // 兑换率：1稳定币 = rate MESH (18位精度)
        bool enabled;               // 是否启用
    }
    
    /** @dev 稳定币配置：稳定币地址 => 配置 */
    mapping(address => StablecoinConfig) public stablecoins;
    
    /** @dev 支持的稳定币列表 */
    address[] public supportedStablecoins;

    // ============ 系统配置 ============
    /** @dev 最小MESH分发数量（防止误操作） */
    uint256 public constant MIN_MESH_AMOUNT = 100 * 10**18; // 100 MESH
    
    /** @dev 最大单笔支付MESH数量（风控） */
    uint256 public constant MAX_MESH_AMOUNT = 1000000 * 10**18; // 1,000,000 MESH
    
    /** @dev 合约最小MESH余额阈值（低于此值暂停自动分发） */
    uint256 public constant MIN_RESERVE_BALANCE = 10000 * 10**18; // 10,000 MESH

    // ============ 事件定义 ============
    /**
     * @dev 支付已处理事件
     */
    event PaymentProcessed(
        bytes32 indexed paymentId,
        address indexed user,
        address stablecoinToken,
        uint256 stablecoinAmount,
        uint256 meshAmount,
        string meshId,
        uint256 timestamp
    );
    
    /**
     * @dev MESH已分发事件
     */
    event MeshDistributed(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 meshAmount
    );
    
    /**
     * @dev 网格已Claim事件
     */
    event MeshClaimed(
        bytes32 indexed paymentId,
        address indexed user,
        string meshId
    );
    
    /**
     * @dev 稳定币配置更新事件
     */
    event StablecoinConfigUpdated(
        address indexed stablecoin,
        uint256 rate,
        bool enabled
    );
    
    // ============ 构造函数 ============
    constructor(
        address _meshToken,
        address _meshesContract,
        address _foundationManage,
        address _x402Verifier
    ) {
        require(_meshToken != address(0), "Invalid mesh token address");
        require(_meshesContract != address(0), "Invalid meshes contract address");
        require(_foundationManage != address(0), "Invalid foundation manage address");
        require(_x402Verifier != address(0), "Invalid X402 verifier address");
        
        meshToken = IERC20(_meshToken);
        meshesContract = Meshes(_meshesContract);
        foundationManage = FoundationManage(_foundationManage);
        x402Verifier = _x402Verifier;
    }

    // ============ 支付处理函数 ============
    /**
     * @dev 处理X402支付回调
     * @param _user 支付用户地址
     * @param _stablecoinToken 稳定币合约地址（address(0)表示原生币）
     * @param _amount 支付金额（稳定币单位）
     * @param _meshId 网格ID（可选，为空字符串则不Claim）
     * @param _nonce 支付nonce（防止重放）
     * @param _timestamp 支付时间戳
     * @param _signature X402系统签名（用于验证支付合法性）
     */
    function processPayment(
        address _user,
        address _stablecoinToken,
        uint256 _amount,
        string memory _meshId,
        uint256 _nonce,
        uint256 _timestamp,
        bytes memory _signature
    ) external nonReentrant whenNotPaused {
        require(_user != address(0), "Invalid user address");
        require(_amount > 0, "Amount must be greater than 0");
        require(!usedNonces[_nonce], "Nonce already used");
        require(_timestamp > 0, "Invalid timestamp");
        
        // 计算支付ID
        bytes32 paymentId = keccak256(
            abi.encodePacked(_user, _stablecoinToken, _amount, _meshId, _nonce, _timestamp)
        );
        
        // 检查支付是否已处理
        require(!payments[paymentId].processed, "Payment already processed");
        
        // 验证支付签名
        require(
            _verifyPaymentSignature(_user, _stablecoinToken, _amount, _meshId, _nonce, _timestamp, _signature),
            "Invalid payment signature"
        );
        
        // 标记nonce为已使用
        usedNonces[_nonce] = true;
        
        // 获取稳定币配置
        StablecoinConfig memory config = stablecoins[_stablecoinToken];
        require(config.enabled, "Stablecoin not supported");
        
        // 计算MESH数量
        uint256 meshAmount = (_amount * config.rate) / 10**18;
        
        // 检查MESH数量限制
        require(meshAmount >= MIN_MESH_AMOUNT, "Mesh amount too small");
        require(meshAmount <= MAX_MESH_AMOUNT, "Mesh amount too large");
        
        // 检查合约MESH余额
        uint256 contractBalance = meshToken.balanceOf(address(foundationManage));
        require(contractBalance >= meshAmount + MIN_RESERVE_BALANCE, "Insufficient MESH reserve");
        
        // 从FoundationManage使用自动转账到用户
        // 注意：X402PaymentGateway需要被设置为 approvedInitiator
        // 并且用户需要被设置为 approvedAutoRecipient
        foundationManage.autoTransferTo(_user, meshAmount);
        
        // 记录支付信息
        payments[paymentId] = PaymentInfo({
            user: _user,
            stablecoinToken: _stablecoinToken,
            amount: _amount,
            meshAmount: meshAmount,
            meshID: _meshId,
            timestamp: _timestamp,
            claimed: false,
            processed: true
        });
        
        userPayments[_user].push(paymentId);
        
        emit PaymentProcessed(paymentId, _user, _stablecoinToken, _amount, meshAmount, _meshId, _timestamp);
        emit MeshDistributed(paymentId, _user, meshAmount);
        
    }

    // ============ 手动Claim函数 ============
    /**
     * @dev 用户手动Claim网格
     * @notice 安全修复：用户必须自己调用 Meshes.claimMesh，确保网格归属正确
     * @notice 此函数仅用于记录Claim状态，实际Claim由用户在前端调用 Meshes.claimMesh
     * @param _paymentId 支付ID
     * @param _meshId 网格ID
     * @notice 用户应该直接调用 meshesContract.claimMesh(_meshId)，而不是通过此合约
     */
    function manualClaimMesh(bytes32 _paymentId, string memory _meshId) external nonReentrant whenNotPaused {
        PaymentInfo storage payment = payments[_paymentId];
        require(payment.processed, "Payment not processed");
        require(payment.user == msg.sender, "Not payment owner");
        require(!payment.claimed, "Mesh already claimed");
        require(bytes(_meshId).length > 0, "Mesh ID cannot be empty");
        
        // 安全修复：不再通过合约调用 claimMesh
        // 用户应该直接调用 meshesContract.claimMesh(_meshId)
        // 这里仅记录状态，实际Claim由用户在前端完成
        // 
        // 注意：此函数已废弃，保留仅为向后兼容
        // 建议用户直接调用 Meshes.claimMesh(_meshId)
        
        payment.claimed = true;
        payment.meshID = _meshId;
        
        emit MeshClaimed(_paymentId, msg.sender, _meshId);
    }

    // ============ 签名验证函数 ============
    /**
     * @dev 验证支付签名
     * @notice 使用EIP-191标准签名格式
     * @notice 注意：实际X402系统的签名格式可能需要根据实际情况调整
     */
    function _verifyPaymentSignature(
        address _user,
        address _stablecoinToken,
        uint256 _amount,
        string memory _meshId,
        uint256 _nonce,
        uint256 _timestamp,
        bytes memory _signature
    ) internal view returns (bool) {
        // 构建待签名消息（包含合约地址防止跨链重放）
        bytes32 messageHash = keccak256(abi.encodePacked(
            address(this),
            _user,
            _stablecoinToken,
            _amount,
            _meshId,
            _nonce,
            _timestamp
        ));
        
        // 使用EIP-191标准前缀
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));
        
        address signer = ethSignedMessageHash.recover(_signature);
        return signer == x402Verifier;
    }

    // ============ 查询函数 ============
    /**
     * @dev 获取支付信息
     */
    function getPayment(bytes32 _paymentId) external view returns (PaymentInfo memory) {
        return payments[_paymentId];
    }
    
    /**
     * @dev 获取用户的支付记录数量
     */
    function getUserPaymentCount(address _user) external view returns (uint256) {
        return userPayments[_user].length;
    }
    
    /**
     * @dev 获取用户的支付记录（分页）
     */
    function getUserPayments(
        address _user,
        uint256 _offset,
        uint256 _limit
    ) external view returns (bytes32[] memory, PaymentInfo[] memory) {
        bytes32[] memory userPaymentIds = userPayments[_user];
        uint256 total = userPaymentIds.length;
        
        if (_offset >= total) {
            return (new bytes32[](0), new PaymentInfo[](0));
        }
        
        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }
        
        uint256 count = end - _offset;
        bytes32[] memory paymentIds = new bytes32[](count);
        PaymentInfo[] memory paymentInfos = new PaymentInfo[](count);
        
        for (uint256 i = 0; i < count; i++) {
            paymentIds[i] = userPaymentIds[_offset + i];
            paymentInfos[i] = payments[paymentIds[i]];
        }
        
        return (paymentIds, paymentInfos);
    }
    
    /**
     * @dev 根据支付金额计算MESH数量（预览）
     */
    function previewMeshAmount(
        address _stablecoinToken,
        uint256 _amount
    ) external view returns (uint256 meshAmount) {
        StablecoinConfig memory config = stablecoins[_stablecoinToken];
        require(config.enabled, "Stablecoin not supported");
        return (_amount * config.rate) / 10**18;
    }
    
    /**
     * @dev 获取支持的稳定币列表
     */
    function getSupportedStablecoins() external view returns (address[] memory) {
        return supportedStablecoins;
    }

    // ============ 管理函数 ============
    /**
     * @dev 设置稳定币配置
     */
    function setStablecoinConfig(
        address _stablecoinToken,
        uint256 _rate,
        bool _enabled
    ) external onlyOwner {
        require(_rate > 0, "Rate must be greater than 0");
        
        StablecoinConfig storage config = stablecoins[_stablecoinToken];
        
        // 如果是从未配置的稳定币，添加到列表
        if (config.tokenAddress == address(0)) {
            supportedStablecoins.push(_stablecoinToken);
        }
        
        config.tokenAddress = _stablecoinToken;
        config.rate = _rate;
        config.enabled = _enabled;
        
        emit StablecoinConfigUpdated(_stablecoinToken, _rate, _enabled);
    }
    
    /**
     * @dev 设置X402验证地址
     */
    function setX402Verifier(address _x402Verifier) external onlyOwner {
        require(_x402Verifier != address(0), "Invalid verifier address");
        x402Verifier = _x402Verifier;
    }
    
    // 注意：MIN_MESH_AMOUNT, MAX_MESH_AMOUNT, MIN_RESERVE_BALANCE 已改为常量，不再提供 setter 函数
    // 如需修改，需要重新部署合约
    
    /**
     * @dev 暂停合约
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev 恢复合约
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev 紧急提取（仅限Owner，用于紧急情况）
     */
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        if (_token == address(0)) {
            payable(owner()).transfer(_amount);
        } else {
            IERC20(_token).transfer(owner(), _amount);
        }
    }
}
