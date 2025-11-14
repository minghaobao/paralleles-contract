# 前端合约调用更新总结

## 更新日期
2025-11-14

## 概述
本文档总结了 `app` 和 `Meshes-web` 目录中所有合约调用的更新，以对应合约命名规范的修改。

---

## app 目录更新

### 已更新的文件

1. **src/utils/apiService.ts**
   - `contract.estimateGas.ClaimMesh` → `contract.estimateGas.claimMesh`
   - `contract.ClaimMesh` → `contract.claimMesh`
   - 日志消息已更新

2. **src/config/contracts.ts**
   - ABI 中的 `"name": "ClaimMesh"` → `"name": "claimMesh"`
   - `getMeshDashboard` 返回类型中的 `totalclaimMints` → `totalClaimMints`

3. **docs/CONTRACTS_SECURITY_AND_RELATIONS.md**
   - 文档中的函数名引用已更新

4. **docs/ENERGY_FIELD_REWARD_SPEC.md**
   - `degreeHeats` → `meshHeats`

---

## Meshes-web 目录更新

### 已更新的文件

1. **lib/blockchain/meshesContract.ts**
   - `this.contract.ClaimMesh` → `this.contract.claimMesh`
   - `totalclaimMints` → `totalClaimMints` (类型定义和返回值)

2. **utils/wallet.js**
   - `ngpObj.ClaimMesh` → `ngpObj.claimMesh`
   - `fallbackContract.ClaimMesh` → `fallbackContract.claimMesh`
   - 日志消息已更新

3. **utils/meshesWallet.js**
   - `totalclaimMints` → `totalClaimMints`
   - `legacyAdapter.ClaimMesh` → 已更新为错误提示（旧方法已废弃）

4. **lib/blockchain/web3Service.ts**
   - `ngpObj.ClaimMesh(value,1)` → `ngpObj.claimMesh(value)` (移除了 count 参数)

5. **lib/blockchain/legacyAdapter.ts**
   - 注释中的 `ClaimMesh` → `claimMesh`
   - 错误消息中的函数名已更新
   - 兼容性映射中的 `'ClaimMesh'` → `'claimMesh'`

6. **lib/blockchain/contractService.js**
   - `totalclaimMints` → `totalClaimMints`

7. **pages/api/mesh/claim-x402.js**
   - 函数签名 `'function ClaimMesh'` → `'function claimMesh'`
   - `encodeFunctionData('ClaimMesh'` → `encodeFunctionData('claimMesh'`

8. **pages/mining.js**
   - `totalclaimMints` → `totalClaimMints`

9. **utils/abi.js**
   - `"name": "ClaimMesh"` → `"name": "claimMesh"`
   - `"name": "activeMinters"` → `"name": "activeClaimers"`
   - `"name": "claimMints"` → `"name": "totalClaimMints"`
   - `"name": "degreeHeats"` → `"name": "meshHeats"`
   - `"name": "FoundationAddr"` → `"name": "treasuryAddress"`
   - `"name": "totalclaimMints"` → `"name": "totalClaimMints"`

10. **lib/blockchain/abis/meshes.abi.js**
    - `"name": "ClaimMesh"` → `"name": "claimMesh"`
    - `"name": "totalclaimMints"` → `"name": "totalClaimMints"`

11. **lib/blockchain/abis/meshes.abi.ts**
    - `"name": "ClaimMesh"` → `"name": "claimMesh"`
    - `"name": "totalclaimMints"` → `"name": "totalClaimMints"`

12. **src/lib/blockchain/abis/meshes.abi.json**
    - 所有函数名、变量名和参数名已通过 sed 批量更新：
      - `ClaimMesh` → `claimMesh`
      - `activeMinters` → `activeClaimers`
      - `claimMints` → `totalClaimMints`
      - `degreeHeats` → `meshHeats`
      - `FoundationAddr` → `treasuryAddress`
      - `meshApplyCount` → `meshClaimCount`
      - `governanceSafe` → `governanceSafeAddress`
      - `treasuryAddr` → `treasuryAddress`
      - `totalclaimMints` → `totalClaimMints`
      - `_foundationAddr` → `_foundationAddress`
      - `_governanceSafe` → `_governanceSafeAddress`
      - `_newFoundationAddr` → `_newFoundationAddress`
      - `setFoundationAddress` → `setTreasuryAddress`

---

## 重要变更说明

### 函数调用变更

1. **claimMesh 方法**
   - **旧**: `contract.ClaimMesh(meshId)` 或 `contract.ClaimMesh(meshId, count)`
   - **新**: `contract.claimMesh(meshId)` (只接受一个参数)

2. **状态变量读取**
   - **旧**: `contract.totalclaimMints()`, `contract.activeMinters()`, `contract.degreeHeats()`, `contract.treasuryAddr()`, `contract.governanceSafe()`
   - **新**: `contract.totalClaimMints()`, `contract.activeClaimers()`, `contract.meshHeats()`, `contract.treasuryAddress()`, `contract.governanceSafeAddress()`

### 参数变更

- `claimMesh` 方法不再接受 `count` 参数
- 如果需要批量认领，需要在前端循环调用 `claimMesh`

---

## 注意事项

1. **向后兼容性**: 这些修改是破坏性的，需要重新部署合约或更新所有调用代码。

2. **ABI 文件**: 所有 ABI 文件都已更新，确保使用最新的 ABI。

3. **错误处理**: 部分旧代码路径（如 `legacyAdapter.ClaimMesh`）现在会抛出错误，提示使用新方法。

4. **测试**: 建议在更新后运行前端测试，确保所有功能正常。

---

## 验证清单

- [x] app/src/utils/apiService.ts 已更新
- [x] app/src/config/contracts.ts 已更新
- [x] Meshes-web/lib/blockchain/meshesContract.ts 已更新
- [x] Meshes-web/utils/wallet.js 已更新
- [x] Meshes-web/utils/meshesWallet.js 已更新
- [x] Meshes-web/lib/blockchain/web3Service.ts 已更新
- [x] Meshes-web/lib/blockchain/legacyAdapter.ts 已更新
- [x] Meshes-web/lib/blockchain/contractService.js 已更新
- [x] Meshes-web/pages/api/mesh/claim-x402.js 已更新
- [x] Meshes-web/pages/mining.js 已更新
- [x] Meshes-web/utils/abi.js 已更新
- [x] Meshes-web/lib/blockchain/abis/*.js 已更新
- [x] Meshes-web/lib/blockchain/abis/*.ts 已更新
- [x] Meshes-web/src/lib/blockchain/abis/meshes.abi.json 已更新
- [x] 文档中的引用已更新

---

## 相关文档

- [命名规范分析报告](../parallels-contract/docs/NAMING_CONVENTIONS_ANALYSIS.md)
- [外部调用更新清单](../parallels-contract/docs/NAMING_CHANGES_EXTERNAL_CALLS.md)
- [命名重构完成报告](../parallels-contract/docs/NAMING_REFACTORING_COMPLETE.md)
