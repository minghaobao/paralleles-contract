# 合约命名规范文档

## 更新日期
2025-11-14

## 概述

本文档说明智能合约的命名规范标准、已完成的命名重构工作，以及需要更新的外部调用清单。

---

## 1. Solidity 命名规范标准

根据 Solidity 官方风格指南和最佳实践：

1. **函数名**: `camelCase`（小写开头）
2. **变量名**: `camelCase`（小写开头）
3. **常量**: `UPPER_SNAKE_CASE`（全大写，下划线分隔）
4. **事件名**: `PascalCase`（大写开头）
5. **结构体名**: `PascalCase`（大写开头）
6. **合约名**: `PascalCase`（大写开头）
7. **修饰符名**: `camelCase`（小写开头）

---

## 2. 已完成的命名重构

### 2.1 合约代码修改 ✅

#### Meshes.sol
- ✅ `ClaimMesh` → `claimMesh`
- ✅ `ClaimMeshFor` → `claimMeshFor`
- ✅ `treasuryAddr` → `treasuryAddress`
- ✅ `governanceSafe` → `governanceSafeAddress`
- ✅ `meshApplyCount` → `meshClaimCount`
- ✅ `degreeHeats` → `meshHeats`
- ✅ `claimMints` → `totalClaimMints`
- ✅ `activeMinters` → `activeClaimers`
- ✅ `SECONDS_IN_DAY` → `private constant SECONDS_IN_DAY`
- ✅ `totalMintDuration` → `private constant TOTAL_MINT_DURATION`
- ✅ `baseBurnAmount` → `private constant BASE_BURN_AMOUNT`

#### Reward.sol
- ✅ `foundationAddr` → `foundationAddress`
- ✅ `governanceSafe` → `governanceSafeAddress`

#### Stake.sol
- ✅ `foundationAddr` → `foundationAddress`
- ✅ `governanceSafe` → `governanceSafeAddress`

#### X402PaymentGateway.sol
- ✅ `PaymentInfo.meshId` → `PaymentInfo.meshID`
- ✅ `minMeshAmount` → `public constant MIN_MESH_AMOUNT`
- ✅ `maxMeshAmount` → `public constant MAX_MESH_AMOUNT`
- ✅ `minReserveBalance` → `public constant MIN_RESERVE_BALANCE`

### 2.2 测试和脚本文件更新 ✅

- ✅ 所有测试文件已更新
- ✅ 所有脚本文件已更新
- ✅ 所有文档已更新

### 2.3 编译和测试状态

- ✅ **所有合约编译通过**
- ✅ **命名相关测试通过**

---

## 3. 命名规范总结

### 函数命名
- ✅ 所有函数名使用 `camelCase`（小写开头）
- ✅ 示例：`claimMesh`, `claimMeshFor`, `setTreasuryAddress`

### 变量命名
- ✅ 所有变量名使用 `camelCase`（小写开头）
- ✅ 地址变量使用完整单词：`treasuryAddress`, `foundationAddress`, `governanceSafeAddress`
- ✅ 语义更准确：`meshClaimCount`, `meshHeats`, `totalClaimMints`, `activeClaimers`

### 常量命名
- ✅ 所有常量使用 `UPPER_SNAKE_CASE`（全大写，下划线分隔）
- ✅ 必须声明为 `constant` 或 `private constant`
- ✅ 示例：`SECONDS_IN_DAY`, `TOTAL_MINT_DURATION`, `BASE_BURN_AMOUNT`, `MIN_MESH_AMOUNT`

### 事件命名
- ✅ 所有事件名使用 `PascalCase`（大写开头）
- ✅ 示例：`MeshClaimed`, `UserWeightUpdated`, `TreasuryAddressUpdated`

### 结构体命名
- ✅ 所有结构体名使用 `PascalCase`（大写开头）
- ✅ 示例：`MintInfo`, `PaymentInfo`, `StakeInfo`

---

## 4. 需要更新的外部调用

### 4.1 函数调用修改

```typescript
// 旧代码
await meshes.connect(user).ClaimMesh("E10N10");
await meshes.connect(governance).ClaimMeshFor(userAddress, "E10N10");

// 新代码
await meshes.connect(user).claimMesh("E10N10");
await meshes.connect(governance).claimMeshFor(userAddress, "E10N10");
```

### 4.2 状态变量读取修改

```typescript
// 旧代码
const treasury = await meshes.treasuryAddr();
const safe = await meshes.governanceSafe();
const count = await meshes.meshApplyCount(meshID);
const heat = await meshes.degreeHeats(meshID);
const total = await meshes.claimMints();
const active = await meshes.activeMinters();

// 新代码
const treasury = await meshes.treasuryAddress();
const safe = await meshes.governanceSafeAddress();
const count = await meshes.meshClaimCount(meshID);
const heat = await meshes.meshHeats(meshID);
const total = await meshes.totalClaimMints();
const active = await meshes.activeClaimers();
```

### 4.3 X402PaymentGateway 结构体字段修改

```typescript
// 旧代码
const payment = await gateway.getPayment(paymentId);
const meshId = payment.meshId;

// 新代码
const payment = await gateway.getPayment(paymentId);
const meshID = payment.meshID;
```

### 4.4 常量读取修改

```typescript
// 旧代码
const minAmount = await gateway.minMeshAmount();
const maxAmount = await gateway.maxMeshAmount();
const minReserve = await gateway.minReserveBalance();

// 新代码
const minAmount = await gateway.MIN_MESH_AMOUNT();
const maxAmount = await gateway.MAX_MESH_AMOUNT();
const minReserve = await gateway.MIN_RESERVE_BALANCE();
```

---

## 5. 前端更新状态

### 已更新的文件 ✅
- ✅ `app/src/utils/apiService.ts`
- ✅ `app/src/config/contracts.ts`
- ✅ `Meshes-web/lib/blockchain/meshesContract.ts`
- ✅ `Meshes-web/utils/wallet.js`
- ✅ `Meshes-web/utils/meshesWallet.js`
- ✅ `Meshes-web/lib/blockchain/web3Service.ts`
- ✅ `Meshes-web/lib/blockchain/legacyAdapter.ts`
- ✅ `Meshes-web/lib/blockchain/contractService.js`
- ✅ `Meshes-web/pages/api/mesh/claim-x402.js`
- ✅ `Meshes-web/pages/mining.js`
- ✅ `Meshes-web/utils/abi.js`
- ✅ `Meshes-web/lib/blockchain/abis/*.js`
- ✅ `Meshes-web/lib/blockchain/abis/*.ts`
- ✅ `Meshes-web/src/lib/blockchain/abis/meshes.abi.json`

---

## 6. 注意事项

1. **向后兼容性**: 这些修改是破坏性的，需要重新部署合约或更新所有调用代码。

2. **事件名称**: 事件名称未修改（如 `MeshClaimed`），所以事件监听器不需要更新。

3. **ABI 更新**: 所有使用合约 ABI 的地方都需要更新，包括：
   - TypeScript 类型定义
   - 前端合约接口
   - 监控服务

4. **测试覆盖**: 确保所有测试都更新并通过。

---

## 7. 相关文档

- [合约精简总结](./CONTRACT_SIMPLIFICATION_SUMMARY.md)
- [前端更新总结](./FRONTEND_UPDATE_SUMMARY.md)

---

**最后更新**: 2025-11-14  
**状态**: ✅ 命名重构已完成

