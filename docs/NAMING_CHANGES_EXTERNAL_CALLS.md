# 命名修改后的外部调用更新清单

## 更新日期
2025-11-14

## 概述
本文档列出了所有需要更新的外部调用，以反映合约命名规范的修改。

---

## 函数名修改

### Meshes.sol

| 旧函数名 | 新函数名 | 影响范围 |
|---------|---------|---------|
| `ClaimMesh(string)` | `claimMesh(string)` | 所有调用此函数的地方 |
| `ClaimMeshFor(address, string)` | `claimMeshFor(address, string)` | 所有调用此函数的地方 |

---

## 状态变量修改

### Meshes.sol

| 旧变量名 | 新变量名 | 类型 | 影响范围 |
|---------|---------|------|---------|
| `treasuryAddr` | `treasuryAddress` | `address public` | 所有读取此变量的地方 |
| `governanceSafe` | `governanceSafeAddress` | `address public` | 所有读取此变量的地方 |
| `meshApplyCount` | `meshClaimCount` | `mapping(string => uint32) public` | 所有读取此映射的地方 |
| `degreeHeats` | `meshHeats` | `mapping(string => uint256) public` | 所有读取此映射的地方 |
| `claimMints` | `totalClaimMints` | `uint256 public` | 所有读取此变量的地方 |
| `activeMinters` | `activeClaimers` | `uint256 public` | 所有读取此变量的地方 |

### Reward.sol

| 旧变量名 | 新变量名 | 类型 | 影响范围 |
|---------|---------|------|---------|
| `foundationAddr` | `foundationAddress` | `address public` | 所有读取此变量的地方 |
| `governanceSafe` | `governanceSafeAddress` | `address public` | 所有读取此变量的地方 |

### Stake.sol

| 旧变量名 | 新变量名 | 类型 | 影响范围 |
|---------|---------|------|---------|
| `foundationAddr` | `foundationAddress` | `address public` | 所有读取此变量的地方 |
| `governanceSafe` | `governanceSafeAddress` | `address public` | 所有读取此变量的地方 |

### X402PaymentGateway.sol

| 旧变量名 | 新变量名 | 类型 | 影响范围 |
|---------|---------|------|---------|
| `PaymentInfo.meshId` | `PaymentInfo.meshID` | `string` | 所有访问此结构体字段的地方 |
| `minMeshAmount` | `MIN_MESH_AMOUNT` | `uint256 public constant` | 所有读取此常量的地方（已删除 setter） |
| `maxMeshAmount` | `MAX_MESH_AMOUNT` | `uint256 public constant` | 所有读取此常量的地方（已删除 setter） |
| `minReserveBalance` | `MIN_RESERVE_BALANCE` | `uint256 public constant` | 所有读取此常量的地方（已删除 setter） |

---

## 需要更新的文件清单

### 1. 测试文件

#### ✅ 已更新
- `test/Meshes.test.ts` - 部分更新（需要继续修复）

#### ⚠️ 需要更新
- `test/MeshesSecurity.test.ts` - 包含 `ClaimMesh` 调用
- `test/Simulation.random.test.ts` - 包含 `ClaimMesh` 调用

### 2. 脚本文件

#### ⚠️ 需要更新
- `scripts/sim-user.ts` - 包含 `ClaimMesh` 调用
- `scripts/sim-tui.ts` - 包含 `ClaimMesh` 调用
- `scripts/simple-liquidity.ts` - 包含 `ClaimMesh` 引用
- `scripts/deploy-simpleswap-only.ts` - 包含 `ClaimMesh` 引用
- `scripts/add-liquidity.ts` - 包含 `ClaimMesh` 引用

### 3. 前端代码（如果存在）

#### ⚠️ 需要检查
- 所有调用 `meshes.ClaimMesh()` 的前端代码
- 所有调用 `meshes.ClaimMeshFor()` 的前端代码
- 所有读取 `meshes.treasuryAddr` 的前端代码
- 所有读取 `meshes.governanceSafe` 的前端代码
- 所有读取 `meshes.meshApplyCount` 的前端代码
- 所有读取 `meshes.degreeHeats` 的前端代码
- 所有读取 `meshes.claimMints` 的前端代码
- 所有读取 `meshes.activeMinters` 的前端代码

### 4. 监控服务（如果存在）

#### ⚠️ 需要检查
- 所有监听 `ClaimMesh` 事件的代码
- 所有读取合约状态变量的代码

### 5. 部署脚本

#### ⚠️ 需要检查
- 所有部署脚本中的构造函数参数（`_governanceSafeAddress` 而不是 `_governanceSafe`）
- 所有部署脚本中的初始化调用

### 6. 文档

#### ⚠️ 需要更新
- `docs/DEPLOYMENT_OPERATIONS_UPDATE.md` - 包含 `ClaimMesh` 引用
- `docs/TEST_VERIFICATION_REPORT.md` - 包含 `ClaimMesh` 引用
- `docs/CONTRACT_SIMPLIFICATION_SUMMARY.md` - 包含 `ClaimMesh` 引用
- `docs/X402_INTEGRATION_GUIDE.md` - 包含 `ClaimMesh` 引用
- `docs/SECURITY_FIXES_IMPLEMENTATION.md` - 包含 `ClaimMesh` 引用

---

## 具体修改示例

### 函数调用修改

```typescript
// 旧代码
await meshes.connect(user).ClaimMesh("E10N10");
await meshes.connect(governance).ClaimMeshFor(userAddress, "E10N10");

// 新代码
await meshes.connect(user).claimMesh("E10N10");
await meshes.connect(governance).claimMeshFor(userAddress, "E10N10");
```

### 状态变量读取修改

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

### 构造函数参数修改

```typescript
// 旧代码（如果存在）
const meshes = await Meshes.deploy(governanceSafe);

// 新代码
const meshes = await Meshes.deploy(governanceSafeAddress);
```

### X402PaymentGateway 结构体字段修改

```typescript
// 旧代码
const payment = await gateway.getPayment(paymentId);
const meshId = payment.meshId;

// 新代码
const payment = await gateway.getPayment(paymentId);
const meshID = payment.meshID;
```

### 常量读取修改

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

## 注意事项

1. **向后兼容性**: 这些修改是破坏性的，需要重新部署合约或更新所有调用代码。

2. **事件名称**: 事件名称未修改（如 `MeshClaimed`），所以事件监听器不需要更新。

3. **ABI 更新**: 所有使用合约 ABI 的地方都需要更新，包括：
   - TypeScript 类型定义
   - 前端合约接口
   - 监控服务

4. **测试覆盖**: 确保所有测试都更新并通过。

5. **文档同步**: 更新所有相关文档以反映新的命名。

---

## 优先级

### 🔴 高优先级（必须立即更新）
1. 测试文件 - 确保测试能够运行
2. 部署脚本 - 确保新部署使用正确的命名

### 🟡 中优先级（尽快更新）
1. 脚本文件 - 确保工具脚本正常工作
2. 前端代码 - 确保用户界面正常工作

### 🟢 低优先级（可以稍后更新）
1. 文档 - 更新文档以反映新命名
2. 监控服务 - 如果监控服务有缓存，可以稍后更新

---

## 验证清单

- [ ] 所有测试文件已更新并通过
- [ ] 所有脚本文件已更新并测试
- [ ] 前端代码已更新并测试
- [ ] 部署脚本已更新并测试
- [ ] 监控服务已更新（如适用）
- [ ] 文档已更新
- [ ] ABI 文件已更新
- [ ] TypeScript 类型定义已更新

