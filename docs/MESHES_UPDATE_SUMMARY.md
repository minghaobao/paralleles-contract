# Meshes 合约更新摘要

## 🎯 更新目标

将 Meshes 合约的代币分配目标从 `FoundationManage` 改为 `MeshesTreasury`，实现更清晰的职责分离和更强的安全性。

---

## 📊 快速对比

| 项目 | 旧版本 | 新版本 |
|------|--------|--------|
| 资金流向 | Meshes → FoundationManage | Meshes → MeshesTreasury → FoundationManage |
| 地址变量 | `FoundationAddr` | `treasuryAddr` |
| 设置函数 | `setFoundationAddress()` | `setTreasuryAddress()` |
| 触发函数 | `payoutFoundationIfDue()` | `payoutTreasuryIfDue()` |
| 构造参数 | (foundationAddr, governanceSafe) | (governanceSafe) |
| 安全层级 | 单层 | 双层（Treasury + Foundation）|

---

## ✅ 已完成的修改

### 1. 合约代码 (Meshes.sol)
- ✅ 变量重命名：`FoundationAddr` → `treasuryAddr`
- ✅ 变量重命名：`pendingFoundationPool` → `pendingTreasuryPool`
- ✅ 函数重命名：`setFoundationAddress` → `setTreasuryAddress`
- ✅ 函数重命名：`payoutFoundationIfDue` → `payoutTreasuryIfDue`
- ✅ 内部函数：`_maybePayoutFoundation` → `_maybePayoutTreasury`
- ✅ 事件更新：所有 Foundation 相关事件改为 Treasury
- ✅ 构造函数：移除 `_foundationAddr` 参数
- ✅ 所有注释和文档字符串更新

### 2. 测试文件 (test/Meshes.test.ts)
- ✅ 变量重命名：`foundation` → `treasury`
- ✅ 部署参数更新
- ✅ 测试用例更新
- ✅ 错误消息更新

### 3. 前端配置
- ✅ functionCategories.ts 更新
- ✅ 函数分类规则更新

### 4. 部署脚本
- ✅ deploy-meshes-testnet.ts 更新

### 5. 文档
- ✅ 创建详细的更新文档 (MESHES_TREASURY_UPDATE.md)
- ✅ 创建摘要文档 (本文件)

---

## 🔑 核心变更

### 构造函数

```solidity
// 旧版本
constructor(address _foundationAddr, address _governanceSafe)

// 新版本  
constructor(address _governanceSafe)
```

### 主要函数

```solidity
// 设置 Treasury 地址（旧：setFoundationAddress）
function setTreasuryAddress(address _newTreasuryAddr) external

// 触发 Treasury 转账（旧：payoutFoundationIfDue）
function payoutTreasuryIfDue() external
```

### 状态变量

```solidity
address public treasuryAddr;           // 旧：FoundationAddr
uint256 public pendingTreasuryPool;    // 旧：pendingFoundationPool
```

---

## 🚀 部署步骤

```bash
# 1. 编译合约
cd /home/bob/ngp-dev/parallels-contract
npx hardhat compile

# 2. 运行测试
npx hardhat test

# 3. 部署 Meshes（测试网）
npx hardhat run scripts/deploy-meshes-testnet.ts --network bsctest

# 4. 部署 MeshesTreasury
# （使用相应的部署脚本）

# 5. 配置地址
# 调用 meshes.setTreasuryAddress(treasuryAddress)
```

---

## 📝 迁移清单

### 对于开发者

- [ ] 更新部署脚本中的构造函数参数
- [ ] 更新合约交互代码（函数名称）
- [ ] 更新事件监听（事件名称）
- [ ] 更新测试用例
- [ ] 重新编译合约
- [ ] 运行完整测试套件
- [ ] 更新前端 ABI
- [ ] 更新文档

### 对于前端

- [ ] 运行 `npm run update-contracts` 更新 ABI
- [ ] 修改函数调用：`setFoundationAddress` → `setTreasuryAddress`
- [ ] 修改函数调用：`payoutFoundationIfDue` → `payoutTreasuryIfDue`
- [ ] 修改变量读取：`FoundationAddr` → `treasuryAddr`
- [ ] 更新事件监听
- [ ] 测试所有功能

---

## ⚠️ 重要提示

1. **这是一个破坏性变更**
   - 现有部署脚本需要更新
   - 前端代码需要修改
   - 事件监听需要更新

2. **部署顺序很重要**
   ```
   Meshes → MeshesTreasury → 配置 → FoundationManage
   ```

3. **测试充分**
   - 在测试网完整测试
   - 验证代币流向
   - 检查事件日志

---

## 📚 相关文档

- [详细更新文档](./MESHES_TREASURY_UPDATE.md)
- [Meshes 合约](../contracts/Meshes.sol)
- [MeshesTreasury 合约](../contracts/MeshesTreasury.sol)

---

## 🎉 更新完成

所有代码、测试和文档已更新完毕，编译成功，可以开始部署测试。

**更新日期**: 2025-11-13  
**版本**: v2.0.0

