# 部署与运维文档更新

## 更新日期
2025-11-13

## 重要变更说明

本文档说明了所有合约的大幅度精简变更，这些变更影响了部署和运维流程。

**重要提示**: 所有合约已经过大幅度精简，只保留最重要的核心功能。详细变更请参考 [CONTRACT_SIMPLIFICATION_SUMMARY.md](./CONTRACT_SIMPLIFICATION_SUMMARY.md)。

---

## 1. Meshes 合约治理变更

### 变更内容
**Meshes 合约恢复了必要的治理接口和事件，支持 Owner 和 Safe 两种治理模式。**

### 重要说明
虽然合约支持两种治理模式，但**建议只使用 Owner 模式**进行治理操作，以简化运维流程。

### 具体变更

#### 1.1 治理权限
- **恢复**: Meshes 合约恢复了治理接口，支持 Owner 和 Safe 两种治理模式
- **治理函数**: `setBurnScale`, `setTreasuryAddress`, `setGovernanceSafe`, `switchToSafeGovernance` 等
- **治理模式**: 默认 Owner 模式，可通过 `switchToSafeGovernance()` 切换到 Safe 模式
- **建议**: 使用 Owner 模式进行治理，简化运维流程

#### 1.2 恢复的治理函数
以下函数已恢复，支持 Owner 和 Safe 两种治理模式：
- `pause()` - 暂停合约（根据治理模式，由 Owner 或 Safe 调用）
- `unpause()` - 恢复合约（根据治理模式，由 Owner 或 Safe 调用）
- `setBurnScale(uint256)` - 设置销毁比例（已恢复）
- `setTreasuryAddress(address)` - 设置国库地址（已恢复）
- `setGovernanceSafe(address)` - 设置治理 Safe 地址（已恢复）
- `switchToSafeGovernance()` - 切换到 Safe 治理模式（已恢复）
- `getGovernanceInfo()` - 获取治理信息（已恢复）
- `transferOwnership(address)` - 转移所有权
- `renounceOwnership()` - 放弃所有权

#### 1.3 恢复的事件
为了确保 monitor-service 等模块的正常运行，恢复了以下事件：
- `BurnScaleUpdated` - 销毁比例更新事件
- `MeshClaimed` - 网格认领事件
- `UserWeightUpdated` - 用户权重更新事件
- `TokensBurned` - 代币销毁事件
- `ClaimCostBurned` - 认领成本销毁事件
- `UnclaimedDecayApplied` - 未认领衰减应用事件

#### 1.4 用户操作不受影响
以下用户操作保持不变，任何用户都可以执行：
- `claimMesh(string)` - 认领网格
- `claimMeshFor(address, string)` - 代他人认领网格
- `withdraw()` - 提取收益
- `payoutTreasuryIfDue()` - 触发国库支付（如果到期）

### 部署注意事项

1. **构造函数变更**
   - **之前**: `constructor(address _foundationAddr, address _governanceSafe)`
   - **现在**: `constructor()` - 无参数构造函数
   - **影响**: 部署时无需传递参数，后续通过 `setTreasuryAddress()` 和 `setGovernanceSafe()` 配置

2. **Owner 地址管理**
   - 确保 Owner 地址安全存储
   - 建议使用硬件钱包或多签钱包作为 Owner
   - 定期备份 Owner 私钥

3. **治理操作流程**
   ```bash
   # 部署后配置
   # 1. 设置国库地址
   meshes.setTreasuryAddress(treasuryAddress)
   
   # 2. 设置治理 Safe 地址（可选）
   meshes.setGovernanceSafe(safeAddress)
   
   # 3. 切换到 Safe 治理模式（可选，建议使用 Owner 模式）
   meshes.switchToSafeGovernance()
   ```

4. **权限验证**
   - 部署后立即验证 Owner 权限
   - 测试 `pause()` 和 `unpause()` 功能
   - 验证事件是否正常触发（用于 monitor-service）

### 运维注意事项

1. **紧急暂停**
   - 紧急情况下，Owner 或 Safe（根据治理模式）可以直接调用 `pause()` 暂停合约
   - 建议使用 Owner 模式，响应时间更快

2. **参数调整**
   - 所有参数调整（如 `setBurnScale`）需要 Owner 或 Safe 签名（根据治理模式）
   - 建议在测试网充分测试后再在主网执行

3. **事件监控**
   - 确保 monitor-service 能够正常监听事件
   - 验证 `MeshClaimed`, `UserWeightUpdated`, `TokensBurned` 等事件是否正常触发

4. **所有权转移**
   - 如需转移所有权，使用 `transferOwnership(newOwner)`
   - 新 Owner 需要调用 `acceptOwnership()` 确认
   - 转移前确保新 Owner 地址正确

---

## 2. X402PaymentGateway 变更

### 变更内容
**X402PaymentGateway 不再代为执行 Claim 操作，只负责分发 MESH 代币。**

### 具体变更

#### 2.1 支付流程变更
- **之前**: 
  ```
  用户支付 → X402 处理 → 分发 MESH → 自动 Claim 网格
  ```
- **现在**: 
  ```
  用户支付 → X402 处理 → 分发 MESH → 用户手动 Claim
  ```

#### 2.2 相关函数
- `processPayment()` - 处理支付并分发 MESH（**不再自动 Claim**）
- `manualClaimMesh()` - 用户手动 Claim 网格（**已废弃，建议直接调用 `Meshes.claimMesh()`**）

#### 2.3 自动 Claim 功能移除
- `autoClaimEnabled` 配置项已移除或不再生效
- 支付完成后，用户需要手动调用 Meshes 合约的 `claimMesh()`

### 部署注意事项

1. **前端集成更新**
   - 前端需要更新支付完成后的流程
   - 支付完成后提示用户手动 Claim 网格
   - 提供 Claim 按钮或自动跳转到 Claim 页面

2. **用户体验优化**
   ```javascript
   // 支付完成后的处理
   async function onPaymentCompleted(paymentId) {
     // 1. 显示支付成功消息
     toast.success('支付成功！MESH 已到账');
     
     // 2. 提示用户 Claim 网格
     toast.info('请点击下方按钮 Claim 网格');
     
     // 3. 显示 Claim 按钮
     showClaimButton(meshId);
   }
   ```

3. **合约配置**
   - 部署时无需配置 `autoClaimEnabled`
   - 确保 `meshesContract` 地址正确配置
   - 确保 `foundationManage` 地址正确配置

### 运维注意事项

1. **用户支持**
   - 用户可能不知道需要手动 Claim
   - 在 UI 中明确提示 Claim 步骤
   - 提供 Claim 操作指南

2. **监控和日志**
   - 监控支付成功但未 Claim 的情况
   - 记录支付和 Claim 的关联关系
   - 定期检查未 Claim 的支付记录

3. **故障处理**
   - 如果用户忘记 Claim，可以引导用户调用 `manualClaimMesh()`
   - 或者用户可以直接调用 Meshes 合约的 `ClaimMesh()`

---

## 3. 测试验证

### 3.1 Meshes 治理测试

```bash
# 运行 Meshes 测试
npm test -- test/Meshes.test.ts

# 验证要点：
# 1. Owner 可以执行治理操作
# 2. 非 Owner 无法执行治理操作
# 3. 用户操作（ClaimMesh, withdraw）正常
```

### 3.2 Reward/Stake 测试

```bash
# 运行 Reward 测试
npm test -- test/Reward.test.ts

# 运行 Stake 测试
npm test -- test/Stake.test.ts

# 验证要点：
# 1. Claim/withdraw 流程正常
# 2. 补仓操作改为手动处理（通过 FoundationManage.autoTransferTo）
# 3. 业务逻辑完整
```

### 3.3 X402 测试

```bash
# 运行 X402 测试
npm test -- test/X402PaymentGateway.test.ts

# 验证要点：
# 1. 支付处理正常
# 2. MESH 分发正常
# 3. 不再自动 Claim
```

---

## 4. 部署检查清单

### Meshes 合约部署

- [ ] 使用 Owner 地址部署合约
- [ ] 验证 Owner 权限（测试 `pause()`）
- [ ] 设置国库地址（`setTreasuryAddress()`）
- [ ] 测试用户操作（`ClaimMesh()`, `withdraw()`）
- [ ] 确认非 Owner 无法执行治理操作

### X402PaymentGateway 部署

- [ ] 部署合约
- [ ] 配置 `meshesContract` 地址
- [ ] 配置 `foundationManage` 地址
- [ ] 配置 `x402Verifier` 地址
- [ ] 设置稳定币汇率
- [ ] 测试支付流程（验证不自动 Claim）
- [ ] 更新前端集成代码

### 前端更新

- [ ] 更新支付完成后的 UI 流程
- [ ] 添加 Claim 提示和按钮
- [ ] 测试完整的支付 → Claim 流程
- [ ] 更新用户文档和帮助

---

## 5. 回滚计划

### 如果出现问题

1. **Meshes 治理问题**
   - 如果 Owner 地址丢失，无法恢复治理权限
   - 建议使用多签钱包作为 Owner
   - 定期备份 Owner 私钥

2. **X402 支付问题**
   - 如果支付处理失败，用户可以退款
   - 如果 MESH 分发失败，需要手动处理
   - 保持 X402 系统与合约的同步

---

## 6. 监控指标

### Meshes 合约监控

- Owner 操作频率
- 用户 Claim 和 withdraw 频率
- 国库支付触发频率
- 合约暂停/恢复事件

### X402 监控

- 支付成功数量
- MESH 分发数量
- 支付后 Claim 转化率
- 未 Claim 的支付数量

---

## 7. 联系和支持

如有问题，请联系开发团队或查看相关文档：
- [合约精简总结](./CONTRACT_SIMPLIFICATION_SUMMARY.md) - **详细变更清单**
- [Meshes 合约文档](./MESHES_UPDATE_SUMMARY.md)
- [X402 集成指南](./X402_INTEGRATION_GUIDE.md)
- [安全修复文档](./SECURITY_FIXES_IMPLEMENTATION.md)

---

## 总结

1. **Meshes 合约**: 恢复了治理接口和事件，支持 Owner 和 Safe 两种治理模式（建议使用 Owner 模式）
2. **X402PaymentGateway**: 不再自动 Claim，用户需要手动 Claim 网格
3. **补仓机制**: 所有自动补仓逻辑已删除，改为手动处理（治理方操作）
4. **用户操作**: Claim/withdraw 流程保持不变，业务逻辑完整
5. **部署要求**: 确保 Owner 地址安全，更新前端集成代码，建立手动补仓流程

这些变更简化了自动机制，提高了可控性，同时保持了核心业务逻辑的完整性。详细变更请参考 [CONTRACT_SIMPLIFICATION_SUMMARY.md](./CONTRACT_SIMPLIFICATION_SUMMARY.md)。

