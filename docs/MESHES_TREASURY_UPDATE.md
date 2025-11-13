# Meshes 合约重大更新：从 FoundationManage 到 MeshesTreasury

## 更新日期
2025-11-13

## 更新概述

本次更新修改了 Meshes 合约的代币分配目标，将原来自动转到 `FoundationManage` 的 MESH 代币改为转向 `MeshesTreasury`，彻底解耦 Meshes 与 FoundationManage 的直接关系。

---

## 变更原因

### 之前的架构问题

1. **耦合度过高**：Meshes 直接将代币转给 FoundationManage，导致两个合约紧密耦合
2. **资金流向不清晰**：Foundation 既作为基金会管理合约，又直接接收 Meshes 的代币分配
3. **安全性考虑**：所有代币直接流向 FoundationManage，缺少 Treasury 层的安全缓冲

### 新架构优势

1. **清晰的资金流向**：
   ```
   Meshes → MeshesTreasury → FoundationManage → 收款方
   ```

2. **职责分离**：
   - **Meshes**: 负责代币铸造和用户奖励
   - **MeshesTreasury**: 负责国库资金管理，需要 Safe 多签
   - **FoundationManage**: 负责自动转账和限额管理

3. **增强的安全性**：
   - Treasury 层提供额外的安全保障
   - Safe 多签控制所有资金流出
   - 自动转账与手动转账分离

---

## 详细变更清单

### 1. 合约变量变更

#### Meshes.sol

| 变更类型 | 旧名称 | 新名称 | 说明 |
|---------|--------|--------|------|
| 状态变量 | `FoundationAddr` | `treasuryAddr` | Treasury 地址 |
| 状态变量 | `pendingFoundationPool` | `pendingTreasuryPool` | 待转 Treasury 池 |
| 事件 | `FoundationAddressUpdated` | `TreasuryAddressUpdated` | Treasury 地址更新事件 |
| 事件 | `FoundationFeeAccrued` | `TreasuryFeeAccrued` | Treasury 费用累积事件 |
| 事件 | `FoundationPayout` | `TreasuryPayout` | Treasury 转账事件 |
| 函数 | `setFoundationAddress` | `setTreasuryAddress` | 设置 Treasury 地址 |
| 函数 | `payoutFoundationIfDue` | `payoutTreasuryIfDue` | 触发 Treasury 转账 |
| 内部函数 | `_maybePayoutFoundation` | `_maybePayoutTreasury` | 内部转账检查 |

### 2. 事件参数变更

#### WithdrawProcessed 事件

```solidity
// 旧版本
event WithdrawProcessed(
    address indexed user,
    uint256 payout,
    uint256 burned,
    uint256 foundation,    // 旧参数名
    uint256 carryAfter,
    uint256 dayIndex
);

// 新版本
event WithdrawProcessed(
    address indexed user,
    uint256 payout,
    uint256 burned,
    uint256 treasury,      // 新参数名
    uint256 carryAfter,
    uint256 dayIndex
);
```

#### UnclaimedDecayApplied 事件

```solidity
// 旧版本
event UnclaimedDecayApplied(
    address indexed user,
    uint256 daysProcessed,
    uint256 burned,
    uint256 foundation,    // 旧参数名
    uint256 carryAfter
);

// 新版本
event UnclaimedDecayApplied(
    address indexed user,
    uint256 daysProcessed,
    uint256 burned,
    uint256 treasury,      // 新参数名
    uint256 carryAfter
);
```

### 3. 函数签名变更

#### setTreasuryAddress (原 setFoundationAddress)

```solidity
// 旧版本
function setFoundationAddress(address _newFoundationAddr) external onlyGovernance whenNotPaused;

// 新版本
function setTreasuryAddress(address _newTreasuryAddr) external onlyGovernance whenNotPaused;
```

**功能说明**：
- 设置 MeshesTreasury 合约地址
- 首次设置时跳过白名单检查
- Owner治理模式下可多次修改
- Safe治理模式下需要白名单检查

#### payoutTreasuryIfDue (原 payoutFoundationIfDue)

```solidity
// 旧版本
function payoutFoundationIfDue() external nonReentrant whenNotPaused;

// 新版本
function payoutTreasuryIfDue() external nonReentrant whenNotPaused;
```

**功能说明**：
- 任何人可发起的 Treasury 转账触发器
- 按小时检查并触发转账
- 无需外部程序依赖

### 4. View 函数变更

#### getDashboard

```solidity
// 旧版本
function getDashboard() external view returns (
    uint256 _totalSupply,
    uint256 _liquidSupply,
    uint256 _destruction,
    uint256 _treasury,      // 合约内余额
    uint256 _foundation     // Foundation 余额
);

// 新版本
function getDashboard() external view returns (
    uint256 _totalSupply,
    uint256 _liquidSupply,
    uint256 _destruction,
    uint256 _pending,       // 合约内待转余额
    uint256 _treasury       // Treasury 余额
);
```

#### previewWithdraw

```solidity
// 旧版本
function previewWithdraw(address _user) external view returns (
    uint256 payoutToday,
    uint256 carryBefore,
    uint256 carryAfterIfNoWithdraw,
    uint256 burnTodayIfNoWithdraw,
    uint256 foundationTodayIfNoWithdraw,  // 旧参数名
    uint256 dayIndex
);

// 新版本
function previewWithdraw(address _user) external view returns (
    uint256 payoutToday,
    uint256 carryBefore,
    uint256 carryAfterIfNoWithdraw,
    uint256 burnTodayIfNoWithdraw,
    uint256 treasuryTodayIfNoWithdraw,    // 新参数名
    uint256 dayIndex
);
```

---

## 构造函数变更

### 旧版本

```solidity
constructor(
    address _foundationAddr,
    address _governanceSafe
) ERC20("Mesh Token", "MESH");
```

### 新版本

```solidity
constructor(
    address _governanceSafe
) ERC20("Mesh Token", "MESH");
```

**重要变更**：
- 移除了 `_foundationAddr` 参数
- `treasuryAddr` 初始化为 `address(0)`
- 需要在部署后通过 `setTreasuryAddress` 函数设置

---

## 代码迁移指南

### 1. 合约部署

#### 旧代码

```solidity
const meshes = await Meshes.deploy(
    foundationAddress,
    governanceSafeAddress
);
```

#### 新代码

```solidity
const meshes = await Meshes.deploy(
    governanceSafeAddress
);

// 部署后设置 Treasury 地址
await meshes.setTreasuryAddress(treasuryAddress);
```

### 2. 读取 Treasury 地址

#### 旧代码

```javascript
const foundationAddr = await meshes.FoundationAddr();
```

#### 新代码

```javascript
const treasuryAddr = await meshes.treasuryAddr();
```

### 3. 设置 Treasury 地址

#### 旧代码

```javascript
await meshes.setFoundationAddress(newFoundationAddress);
```

#### 新代码

```javascript
await meshes.setTreasuryAddress(newTreasuryAddress);
```

### 4. 触发转账

#### 旧代码

```javascript
await meshes.payoutFoundationIfDue();
```

#### 新代码

```javascript
await meshes.payoutTreasuryIfDue();
```

### 5. 监听事件

#### 旧代码

```javascript
meshes.on("FoundationPayout", (amount, time) => {
    console.log("Foundation received:", amount);
});

meshes.on("FoundationAddressUpdated", (oldAddr, newAddr) => {
    console.log("Foundation address updated");
});
```

#### 新代码

```javascript
meshes.on("TreasuryPayout", (amount, time) => {
    console.log("Treasury received:", amount);
});

meshes.on("TreasuryAddressUpdated", (oldAddr, newAddr) => {
    console.log("Treasury address updated");
});
```

---

## 测试文件变更

### test/Meshes.test.ts

#### 主要变更

1. **变量重命名**：
   ```typescript
   // 旧：let foundation: any;
   // 新：let treasury: any;
   ```

2. **部署参数调整**：
   ```typescript
   // 旧：
   meshes = await MeshesF.connect(governanceSafe).deploy(
       foundation.address,
       governanceSafe.address
   );
   
   // 新：
   meshes = await MeshesF.connect(governanceSafe).deploy(
       governanceSafe.address
   );
   ```

3. **测试用例更新**：
   - 将所有 `FoundationAddr` 改为 `treasuryAddr`
   - 将所有 `setFoundationAddress` 改为 `setTreasuryAddress`
   - 更新错误消息匹配字符串

---

## 前端集成变更

### 1. 合约 ABI 更新

运行以下命令更新前端使用的 ABI：

```bash
cd management
npm run update-contracts
```

或

```bash
cd parallels-contract
node scripts/extract-artifacts.js
```

### 2. 函数分类配置更新

文件：`management/src/lib/contracts/functionCategories.ts`

已更新的函数名称：
- `setFoundationAddress` → `setTreasuryAddress`
- `payoutFoundationIfDue` → `payoutTreasuryIfDue`
- `FoundationAddr` → `treasuryAddr`
- `pendingFoundationPool` → `pendingTreasuryPool`

### 3. 前端代码更新

#### 读取 Treasury 地址

```typescript
// 旧代码
const foundationAddr = await meshesContract.FoundationAddr();

// 新代码
const treasuryAddr = await meshesContract.treasuryAddr();
```

#### 调用管理函数

```typescript
// 旧代码
await meshesContract.setFoundationAddress(newAddress);

// 新代码
await meshesContract.setTreasuryAddress(newAddress);
```

---

## 部署流程

### 完整部署顺序

1. **部署 Meshes 合约**：
   ```typescript
   const meshes = await Meshes.deploy(governanceSafeAddress);
   ```

2. **部署 MeshesTreasury 合约**：
   ```typescript
   const treasury = await MeshesTreasury.deploy(governanceSafeAddress);
   ```

3. **配置 MeshesTreasury**：
   ```typescript
   await treasury.setMeshToken(meshes.address);
   ```

4. **配置 Meshes**：
   ```typescript
   await meshes.setTreasuryAddress(treasury.address);
   ```

5. **部署 FoundationManage**（可选）：
   ```typescript
   const foundation = await FoundationManage.deploy(governanceSafeAddress);
   await foundation.setMeshToken(meshes.address);
   await foundation.setTreasury(treasury.address);
   ```

6. **配置 Treasury 的 FoundationManage 地址**（可选）：
   ```typescript
   await treasury.setFoundationManage(foundation.address);
   ```

---

## 向后兼容性

### ⚠️ 破坏性变更

本次更新包含以下破坏性变更：

1. **构造函数参数变更**：
   - 移除了 `_foundationAddr` 参数
   - 现有部署脚本需要更新

2. **函数名称变更**：
   - `setFoundationAddress` → `setTreasuryAddress`
   - `payoutFoundationIfDue` → `payoutTreasuryIfDue`

3. **状态变量变更**：
   - `FoundationAddr` → `treasuryAddr`
   - `pendingFoundationPool` → `pendingTreasuryPool`

4. **事件名称变更**：
   - `FoundationAddressUpdated` → `TreasuryAddressUpdated`
   - `FoundationFeeAccrued` → `TreasuryFeeAccrued`
   - `FoundationPayout` → `TreasuryPayout`

### 升级路径

**对于已部署的合约**：
- 无法直接升级，需要重新部署
- 建议先在测试网充分测试
- 迁移时需要考虑现有用户余额和状态

**对于新部署**：
- 按照新的部署流程进行
- 确保按顺序完成所有配置步骤

---

## 安全注意事项

1. **地址设置顺序很重要**：
   - 必须先部署 Meshes 和 MeshesTreasury
   - 然后相互配置地址
   - 最后再部署和配置 FoundationManage

2. **权限管理**：
   - 只有治理地址可以调用 `setTreasuryAddress`
   - 首次设置不需要白名单检查
   - Safe 治理模式下的后续修改需要白名单验证

3. **资金流向验证**：
   - 确保 Treasury 地址正确设置
   - 定期检查代币流向
   - 监控事件日志

4. **测试建议**：
   - 在测试网充分测试所有功能
   - 验证代币转账流程
   - 测试紧急暂停功能

---

## 相关合约

### MeshesTreasury

- 职责：国库资金管理，Safe 多签控制
- 接收：来自 Meshes 的代币分配
- 功能：
  - 基础转账（需 Safe 批准）
  - 自动平衡到 FoundationManage
  - 紧急提取

### FoundationManage

- 职责：自动转账和限额管理
- 接收：来自 MeshesTreasury 的补充
- 功能：
  - 自动转账给批准的收款方
  - 限额管理（单笔、每日、全局）
  - 支持 Reward 和 Stake 合约

---

## 常见问题

### Q1: 为什么要做这次变更？

**A**: 为了实现更清晰的职责分离和更强的安全性。Treasury 层提供了额外的安全保障，所有资金流出都需要 Safe 多签批准。

### Q2: 现有合约需要升级吗？

**A**: 如果合约尚未部署到主网，建议使用新版本。如果已部署，需要重新部署新合约并迁移状态。

### Q3: 会影响用户的代币余额吗？

**A**: 不会。这只是改变了代币的分配目标地址，不影响用户已持有的代币。

### Q4: 前端需要做哪些修改？

**A**: 主要是更新合约 ABI 和修改函数调用名称。详见"前端集成变更"章节。

### Q5: 如何验证修改后的合约正常工作？

**A**: 
1. 运行单元测试：`npx hardhat test`
2. 在测试网部署并验证
3. 检查事件日志
4. 验证代币流向

---

## 相关文档

- [Meshes 合约文档](./Meshes.md)
- [MeshesTreasury 合约文档](./MeshesTreasury.md)
- [FoundationManage 合约文档](./FoundationManage.md)
- [合约架构图](./ARCHITECTURE.md)

---

## 版本信息

- **更新版本**: v2.0.0
- **更新日期**: 2025-11-13
- **编译器版本**: Solidity ^0.8.0
- **OpenZeppelin 版本**: ^4.0.0

---

## 总结

本次更新通过将 Meshes 的代币分配目标从 FoundationManage 改为 MeshesTreasury，实现了：

✅ 更清晰的职责分离  
✅ 更强的安全性（Safe 多签保护）  
✅ 更灵活的资金管理  
✅ 更好的可维护性  

虽然这是一个破坏性变更，但为整个系统带来了显著的架构改进和安全增强。

---

**最后更新**: 2025-11-13  
**作者**: Parallels Team

