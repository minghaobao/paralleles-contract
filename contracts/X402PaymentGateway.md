# X402支付网关合约设计文档

## 概述

`X402PaymentGateway`合约实现了X402支付协议与MESH代币系统的集成，允许用户使用稳定币支付后自动获得MESH代币并完成网格Claim操作。

## 核心功能

### 1. 支付处理
- 接收X402支付系统回调
- 验证支付签名和金额
- 记录支付信息

### 2. 稳定币支持
- 支持多种稳定币（USDT, USDC, DAI等）
- 灵活的汇率配置
- 实时汇率更新

### 3. 自动MESH分发
- 根据支付金额和汇率计算MESH数量
- 从FoundationManage合约自动转账MESH
- 设置最小/最大分发限制

### 4. 自动Claim
- 可选自动Claim网格功能
- 支持失败重试机制
- 提供手动Claim接口

## 合约接口

### 主要函数

#### `processPayment`
处理X402支付回调，自动分发MESH并可选Claim网格。

**参数：**
- `_user`: 支付用户地址
- `_stablecoinToken`: 稳定币合约地址
- `_amount`: 支付金额
- `_meshId`: 网格ID（可选）
- `_nonce`: 支付nonce
- `_timestamp`: 支付时间戳
- `_signature`: X402系统签名

#### `previewMeshAmount`
预览根据支付金额可获得的MESH数量。

#### `manualClaimMesh`
手动Claim网格（用于自动Claim失败的情况）。

### 配置函数

#### `setStablecoinConfig`
配置稳定币汇率和启用状态。

#### `setX402Verifier`
设置X402验证地址。

#### `setAutoClaimEnabled`
启用/禁用自动Claim功能。

## 安全特性

1. **签名验证**：使用ECDSA验证X402支付回调的合法性
2. **重放保护**：使用nonce防止重复处理
3. **重入保护**：使用ReentrancyGuard防止重入攻击
4. **暂停机制**：支持紧急暂停
5. **限额保护**：设置最小/最大MESH数量限制

## 使用流程

### 前端集成

1. 用户选择网格并点击Claim
2. 前端显示X402支付选项
3. 用户选择稳定币和支付金额
4. 前端调用X402支付接口
5. 用户完成支付
6. X402系统发送回调到合约
7. 合约自动分发MESH并Claim网格

### 后端集成

X402支付系统需要：
1. 验证支付完成
2. 生成支付签名
3. 调用合约的`processPayment`函数
4. 传入正确的参数和签名

## 汇率配置示例

```solidity
// USDT: 1 USDT = 1000 MESH
setStablecoinConfig(usdtAddress, 1000 * 10**18, true);

// USDC: 1 USDC = 1000 MESH
setStablecoinConfig(usdcAddress, 1000 * 10**18, true);

// DAI: 1 DAI = 1000 MESH
setStablecoinConfig(daiAddress, 1000 * 10**18, true);
```

## 事件监听

合约发出以下事件，前端可以监听：

- `PaymentProcessed`: 支付已处理
- `MeshDistributed`: MESH已分发
- `MeshClaimed`: 网格已Claim

## 测试建议

1. 测试正常支付流程
2. 测试签名验证失败
3. 测试重复支付（nonce检查）
4. 测试自动Claim成功/失败
5. 测试汇率更新
6. 测试暂停/恢复功能

