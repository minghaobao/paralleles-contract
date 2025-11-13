# Meshes 资金流向说明

## 更新日期
2025-11-12

## 概述

本文档说明 Meshes 合约的资金流向机制，特别是基金会代币分配的流程。

---

## 资金流向

### 完整流程

```
Meshes 合约
    ↓ (自动转账，按小时)
MeshesTreasury 合约
    ↓ (通过 Safe 多签或自动平衡)
FoundationManage 合约
    ↓ (自动转账)
最终收款方（Reward、Stake、X402PaymentGateway 等）
```

---

## 详细说明

### 1. Meshes → MeshesTreasury

**触发机制**：
- 自动触发：在 `ClaimMesh()` 和 `withdraw()` 函数中，如果满足条件会自动调用 `_maybePayoutFoundation()`
- 手动触发：任何人都可以调用 `payoutFoundationIfDue()` 函数手动触发转账

**转账条件**：
- 当前小时索引 > 上次转账小时索引
- 待转池 (`pendingFoundationPool`) 有余额
- MeshesTreasury 地址已设置

**转账金额**：
- 将 `pendingFoundationPool` 中的所有余额转给 MeshesTreasury
- 转账后清空待转池

**资金来源**：
- 用户未提取代币的日衰减：每天 10% 分配给基金会
- 这些代币会累积到 `pendingFoundationPool`，等待转给 MeshesTreasury

**相关函数**：
- `_maybePayoutFoundation()`: 内部函数，检查并执行转账
- `payoutFoundationIfDue()`: 外部函数，允许手动触发转账
- `setFoundationAddress()`: 设置 MeshesTreasury 地址

---

### 2. MeshesTreasury → FoundationManage

**转账方式**：

#### 方式 1：Safe 多签转账（推荐）
- 通过 Gnosis Safe 多签钱包执行转账
- 需要多个签名者批准
- 最高安全性

#### 方式 2：自动平衡机制
- 调用 `balanceFoundationManage()` 函数
- 根据配置的比例自动平衡 Treasury 和 FoundationManage 的余额
- 可以设置自动平衡阈值和时间间隔

**相关函数**：
- `transfer()`: Safe 多签转账（仅限 Safe 调用）
- `balanceFoundationManage()`: 自动平衡余额
- `setAutoBalance()`: 配置自动平衡参数

---

### 3. FoundationManage → 最终收款方

**转账方式**：
- 自动转账：通过 `autoTransferTo()` 函数
- 需要满足限额和权限要求

**收款方类型**：
- Reward 合约：发放奖励
- Stake 合约：质押功能
- X402PaymentGateway：X402 支付网关
- 其他批准的收款方

**相关函数**：
- `autoTransferTo()`: 自动转账到批准的收款方
- `setAutoRecipient()`: 设置批准的收款方
- `setInitiator()`: 设置批准的发起方

---

## 合约配置

### Meshes 合约配置

1. **设置 MeshesTreasury 地址**：
   ```solidity
   meshes.setFoundationAddress(meshesTreasuryAddress);
   ```

2. **验证配置**：
   - MeshesTreasury 必须已初始化（meshToken 已设置）
   - MeshesTreasury 的 meshToken 必须指向 Meshes 合约

### MeshesTreasury 合约配置

1. **设置 Mesh 代币地址**：
   ```solidity
   meshesTreasury.setMeshToken(meshesAddress);
   ```

2. **设置 FoundationManage 地址**：
   ```solidity
   meshesTreasury.setFoundationManage(foundationManageAddress);
   ```

3. **配置收款白名单**：
   ```solidity
   meshesTreasury.setRecipient(foundationManageAddress, true);
   ```

4. **配置自动平衡**（可选）：
   ```solidity
   meshesTreasury.setAutoBalance(
       true,           // 启用自动平衡
       1000 ether,     // 自动平衡阈值
       3600,          // 最小时间间隔（秒）
       50             // 余额比例（50%）
   );
   ```

### FoundationManage 合约配置

1. **设置 Mesh 代币地址**：
   ```solidity
   foundationManage.setMeshToken(meshesAddress);
   ```

2. **设置批准的发起方**：
   ```solidity
   foundationManage.setInitiator(rewardAddress, true);
   foundationManage.setInitiator(stakeAddress, true);
   foundationManage.setInitiator(x402PaymentGatewayAddress, true);
   ```

3. **设置批准的收款方**：
   ```solidity
   foundationManage.setAutoRecipient(userAddress, true);
   ```

4. **配置自动转账限额**：
   ```solidity
   foundationManage.setAutoLimit(
       rewardAddress,
       10000 ether,    // 单次最大转账
       100000 ether,   // 每日最大转账
       true            // 启用
   );
   ```

---

## 关键变量说明

### Meshes 合约

- `FoundationAddr`: MeshesTreasury 合约地址（存储 MeshesTreasury 地址）
- `pendingFoundationPool`: 待转给 MeshesTreasury 的代币池
- `lastPayoutHour`: 上次向 MeshesTreasury 转账的小时索引

### MeshesTreasury 合约

- `meshToken`: Mesh 代币合约地址
- `foundationManage`: FoundationManage 合约地址
- `safeAddress`: Gnosis Safe 多签钱包地址
- `approvedRecipients`: 批准的收款方白名单

### FoundationManage 合约

- `meshToken`: Mesh 代币合约地址
- `approvedInitiators`: 批准的发起方白名单
- `approvedAutoRecipients`: 批准的自动收款方白名单
- `autoLimits`: 自动转账限额配置

---

## 安全特性

### Meshes → MeshesTreasury

1. **地址验证**：
   - 设置 MeshesTreasury 地址时验证其已初始化
   - 验证 meshToken 匹配

2. **时间限制**：
   - 按小时转账，防止频繁转账

3. **权限控制**：
   - 仅治理地址可以设置 MeshesTreasury 地址

### MeshesTreasury → FoundationManage

1. **多签保护**：
   - 所有转账必须通过 Safe 多签批准

2. **白名单机制**：
   - 只有批准的收款方才能接收转账

3. **自动平衡限制**：
   - 可以设置自动平衡阈值和时间间隔
   - 防止频繁自动转账

### FoundationManage → 最终收款方

1. **多级限额**：
   - 发起方限额（单次、每日）
   - 收款方限额（单次、每日）
   - 全局限额（每日）

2. **权限控制**：
   - 只有批准的发起方和收款方才能执行自动转账

3. **余额监控**：
   - 自动检查余额状态
   - 低余额时自动请求补充

---

## 事件追踪

### Meshes 合约事件

- `FoundationAddressUpdated`: MeshesTreasury 地址更新
- `FoundationFeeAccrued`: 基金会费用累积
- `FoundationPayout`: 向 MeshesTreasury 转账

### MeshesTreasury 合约事件

- `TransferExecuted`: 转账执行（Safe 多签）
- `BalanceBalanced`: 余额平衡执行

### FoundationManage 合约事件

- `AutoTransferExecuted`: 自动转账执行
- `RefillRequested`: 补充资金请求

---

## 常见问题

### Q1: 为什么需要 MeshesTreasury？

**A**: MeshesTreasury 作为中间层，提供以下优势：
- 增强安全性：所有转账必须通过 Safe 多签
- 资金管理：集中管理基金会资金
- 灵活分配：可以根据需要向 FoundationManage 分配资金

### Q2: 资金多久转一次？

**A**: 
- Meshes → MeshesTreasury：按小时（如果待转池有余额）
- MeshesTreasury → FoundationManage：根据配置（Safe 多签或自动平衡）

### Q3: 如何手动触发转账？

**A**: 
- Meshes → MeshesTreasury：调用 `payoutFoundationIfDue()`
- MeshesTreasury → FoundationManage：通过 Safe 多签调用 `transfer()`

### Q4: 如果 MeshesTreasury 地址未设置会怎样？

**A**: 
- `_maybePayoutFoundation()` 会检查地址是否已设置
- 如果未设置，会抛出错误 "Treasury address not set"
- 代币会累积在 `pendingFoundationPool` 中，等待地址设置后转账

---

## 总结

Meshes 合约的资金流向已经更新为：

1. ✅ **Meshes → MeshesTreasury**（自动转账，按小时）
2. ✅ **MeshesTreasury → FoundationManage**（Safe 多签或自动平衡）
3. ✅ **FoundationManage → 最终收款方**（自动转账，带限额控制）

这种三层架构提供了更好的安全性和资金管理能力。

---

**最后更新**: 2025-11-12  
**版本**: 1.0

