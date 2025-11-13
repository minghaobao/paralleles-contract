# MeshesTreasury 权限控制说明

## 更新日期
2025-11-12

## 概述

MeshesTreasury 合约实现了严格的权限控制机制，确保所有关键管理功能必须通过 Safe 多签授权。本文档详细说明权限控制的设计和实现。

---

## 权限模型

### 两种治理模式

#### 1. Owner 治理模式（初始模式）

- **默认模式**：合约部署后默认处于 Owner 治理模式
- **权限分配**：
  - Owner：可以设置基础配置（Safe 地址、Mesh 代币地址）
  - Safe：可以执行转账操作和关键配置
- **适用场景**：合约部署和初始配置阶段

#### 2. Safe 治理模式（推荐模式）

- **切换方式**：Owner 调用 `switchToSafeGovernance()` 切换到 Safe 治理模式
- **权限分配**：
  - Owner：只能查看，无法修改配置
  - Safe：可以执行所有转账操作和关键配置
- **适用场景**：生产环境，需要去中心化治理
- **特点**：一旦切换，无法回退到 Owner 模式

---

## 权限分类

### 1. 仅 Safe 执行（onlySafeExec）

以下功能**必须**通过 Safe 多签授权：

#### 资金操作
- `transferTo()` - 基础转账
- `transferToWithReason()` - 带原因ID的转账
- `balanceFoundationManage()` - 手动平衡余额
- `emergencyWithdrawFromFoundation()` - 紧急提取

#### 合约控制
- `pause()` - 暂停合约
- `unpause()` - 恢复合约

#### 关键配置（必须 Safe 授权）
- `setFoundationManage()` - 设置 FoundationManage 地址
- `setRecipient()` - 设置收款白名单（单个）
- `setRecipients()` - 设置收款白名单（批量）
- `setAutoBalance()` - 设置自动平衡参数
- `setMinBalanceInterval()` - 设置最小平衡间隔

### 2. 治理者权限（onlyGovernance）

以下功能由**当前治理者**（Owner 或 Safe）执行：

#### 基础配置
- `setSafe()` - 设置 Safe 地址
  - Owner 模式：Owner 可以调用
  - Safe 模式：只能 Safe 调用
- `setMeshToken()` - 设置 Mesh 代币地址
  - Owner 模式：Owner 可以调用
  - Safe 模式：只能 Safe 调用
  - 只能设置一次

### 3. 仅 Owner 执行（onlyContractOwner）

以下功能**只能**由 Owner 执行（无论治理模式）：

- `switchToSafeGovernance()` - 切换到 Safe 治理模式
  - 只能调用一次
  - 一旦切换，无法回退

---

## 权限矩阵

| 功能 | Owner 模式 | Safe 模式 | 说明 |
|------|-----------|----------|------|
| `transferTo()` | ❌ | ✅ | 仅 Safe |
| `transferToWithReason()` | ❌ | ✅ | 仅 Safe |
| `pause()` / `unpause()` | ❌ | ✅ | 仅 Safe |
| `setSafe()` | ✅ | ✅ | 治理者 |
| `setMeshToken()` | ✅ | ✅ | 治理者（只能一次） |
| `setFoundationManage()` | ❌ | ✅ | 仅 Safe |
| `setRecipient()` | ❌ | ✅ | 仅 Safe |
| `setRecipients()` | ❌ | ✅ | 仅 Safe |
| `setAutoBalance()` | ❌ | ✅ | 仅 Safe |
| `setMinBalanceInterval()` | ❌ | ✅ | 仅 Safe |
| `balanceFoundationManage()` | ⚠️ | ✅ | Safe 随时可调用，其他人需满足条件 |
| `switchToSafeGovernance()` | ✅ | ❌ | 仅 Owner，只能一次 |

---

## 安全特性

### 1. 治理模式锁定

- 一旦切换到 Safe 治理模式，无法回退
- 通过 `governanceLocked` 标志防止重复切换
- 确保治理的去中心化和安全性

### 2. 暂停保护

- 所有关键配置函数都添加了 `whenNotPaused` 修饰符
- 紧急情况下可以暂停合约，防止恶意操作
- 只有 Safe 可以暂停/恢复合约

### 3. 地址验证

- 所有地址参数都进行零地址检查
- 防止设置无效地址
- 重复设置检查，防止无意义的操作

### 4. 白名单控制

- 只有白名单中的地址才能接收转账
- 白名单管理必须通过 Safe 多签
- 防止资金流向未授权的地址

---

## 使用流程

### 初始部署阶段（Owner 模式）

1. **部署合约**
   ```solidity
   MeshesTreasury treasury = new MeshesTreasury(safeAddress);
   ```

2. **设置 Mesh 代币地址**（Owner）
   ```solidity
   treasury.setMeshToken(meshesAddress);
   ```

3. **设置 FoundationManage 地址**（需要 Safe）
   ```solidity
   // 通过 Safe 多签调用
   treasury.setFoundationManage(foundationManageAddress);
   ```

4. **设置收款白名单**（需要 Safe）
   ```solidity
   // 通过 Safe 多签调用
   treasury.setRecipient(foundationManageAddress, true);
   ```

5. **配置自动平衡**（需要 Safe）
   ```solidity
   // 通过 Safe 多签调用
   treasury.setAutoBalance(true, 1000 ether, 50);
   ```

### 切换到 Safe 治理模式

1. **确认配置完成**
   - 所有关键配置已设置
   - Safe 地址已正确配置

2. **切换到 Safe 治理模式**（Owner）
   ```solidity
   treasury.switchToSafeGovernance();
   ```

3. **验证切换结果**
   ```solidity
   (bool isSafe, bool locked, address governance) = treasury.getGovernanceInfo();
   // isSafe = true, locked = true, governance = safeAddress
   ```

### 生产环境（Safe 模式）

所有关键操作必须通过 Safe 多签：

1. **转账操作**
   ```solidity
   // 通过 Safe 多签调用
   treasury.transferTo(recipient, amount);
   ```

2. **配置更新**
   ```solidity
   // 通过 Safe 多签调用
   treasury.setRecipient(newRecipient, true);
   treasury.setAutoBalance(true, newThreshold, newRatio);
   ```

3. **紧急操作**
   ```solidity
   // 通过 Safe 多签调用
   treasury.pause(); // 暂停合约
   treasury.emergencyWithdrawFromFoundation(amount); // 紧急提取
   ```

---

## 事件追踪

### 治理模式事件

- `GovernanceModeSwitched`: 治理模式切换
- `GovernanceModeLocked`: 治理模式锁定

### 配置更新事件

- `SafeUpdated`: Safe 地址更新
- `MeshTokenUpdated`: Mesh 代币地址设置
- `FoundationManageUpdated`: FoundationManage 地址更新
- `RecipientApproved`: 收款白名单更新
- `AutoBalanceEnabledUpdated`: 自动平衡启用状态更新
- `AutoBalanceThresholdUpdated`: 自动平衡阈值更新
- `BalanceRatioUpdated`: 余额比例更新
- `MinBalanceIntervalUpdated`: 最小平衡间隔更新

### 操作事件

- `TransferExecuted`: 转账执行
- `BalanceBalanced`: 余额平衡执行

---

## 最佳实践

### 1. 部署后立即切换

- 完成初始配置后，立即切换到 Safe 治理模式
- 避免在 Owner 模式下长期运行

### 2. 使用 Safe 多签

- 所有关键操作都通过 Safe 多签执行
- 设置合理的签名阈值（建议 2/3 或更高）

### 3. 定期审计

- 定期检查治理模式状态
- 监控所有配置变更事件
- 验证白名单地址的合法性

### 4. 紧急响应

- 准备紧急暂停流程
- 设置紧急提取机制
- 定期测试紧急响应流程

---

## 常见问题

### Q1: 为什么关键配置必须通过 Safe？

**A**: 为了确保资金安全，所有影响资金流向的配置都需要多签授权，防止单点故障和恶意操作。

### Q2: 切换到 Safe 模式后还能改回 Owner 模式吗？

**A**: 不能。一旦切换到 Safe 治理模式，就无法回退。这是为了确保治理的去中心化。

### Q3: Owner 模式下的风险是什么？

**A**: Owner 模式是单点控制，如果 Owner 私钥泄露，攻击者可以修改关键配置。建议尽快切换到 Safe 模式。

### Q4: 如何验证当前治理模式？

**A**: 调用 `getGovernanceInfo()` 函数查看当前治理模式状态。

### Q5: 如果 Safe 地址需要更换怎么办？

**A**: 在 Owner 模式下，Owner 可以调用 `setSafe()` 更换。在 Safe 模式下，需要当前 Safe 调用 `setSafe()` 更换。

---

## 总结

MeshesTreasury 合约实现了严格的权限控制：

1. ✅ **关键配置必须 Safe 授权**：所有影响资金安全的配置都需要 Safe 多签
2. ✅ **治理模式切换**：支持从 Owner 模式切换到 Safe 模式
3. ✅ **不可回退**：一旦切换到 Safe 模式，无法回退，确保去中心化
4. ✅ **暂停保护**：所有关键操作都支持暂停机制
5. ✅ **事件追踪**：所有操作都有事件记录，便于审计

这种设计确保了资金安全和治理的去中心化。

---

**最后更新**: 2025-11-12  
**版本**: 1.0

