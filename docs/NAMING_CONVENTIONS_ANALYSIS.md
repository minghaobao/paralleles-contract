# 合约命名规范分析报告

## 更新日期
2025-11-14

## Solidity 命名规范标准

根据 Solidity 官方风格指南和最佳实践：

1. **函数名**: `camelCase`（小写开头）
2. **变量名**: `camelCase`（小写开头）
3. **常量**: `UPPER_SNAKE_CASE`（全大写，下划线分隔）
4. **事件名**: `PascalCase`（大写开头）
5. **结构体名**: `PascalCase`（大写开头）
6. **合约名**: `PascalCase`（大写开头）
7. **修饰符名**: `camelCase`（小写开头）

---

## 命名不规范问题清单

### 1. 函数名以大写字母开头 ❌

#### Meshes.sol

| 行号 | 当前命名 | 应改为 | 说明 |
|------|---------|--------|------|
| 611 | `function ClaimMesh` | `function claimMesh` | 函数名应以小写开头 |
| 619 | `function ClaimMeshFor` | `function claimMeshFor` | 函数名应以小写开头 |

**影响**: 
- 不符合 Solidity 命名规范
- 与 OpenZeppelin 标准不一致
- 可能导致前端调用混淆

**建议修复**:
```solidity
// 当前
function ClaimMesh(string memory _meshID) external ...
function ClaimMeshFor(address _user, string memory _meshID) external ...

// 应改为
function claimMesh(string memory _meshID) external ...
function claimMeshFor(address _user, string memory _meshID) external ...
```

---

### 2. 常量命名不规范 ⚠️

#### Meshes.sol

| 行号 | 当前命名 | 应改为 | 说明 |
|------|---------|--------|------|
| 46 | `uint256 SECONDS_IN_DAY = 86400;` | `uint256 private constant SECONDS_IN_DAY = 86400;` | 常量应使用 `constant` 关键字，并遵循 `UPPER_SNAKE_CASE` |

**当前问题**:
- `SECONDS_IN_DAY` 不是 `constant`，但命名像常量
- 应该声明为 `private constant` 或 `public constant`

**建议修复**:
```solidity
// 当前
uint256 SECONDS_IN_DAY = 86400;

// 应改为
uint256 private constant SECONDS_IN_DAY = 86400;
```

**对比**: Stake.sol 中已正确声明：
```solidity
uint256 public constant SECONDS_IN_DAY = 86400;  // ✅ 正确
uint256 public constant APY_BASE = 10000;       // ✅ 正确
```

---

### 3. 变量命名不够准确或不够清晰 ⚠️

#### Meshes.sol

| 行号 | 当前命名 | 建议命名 | 说明 |
|------|---------|---------|------|
| 46 | `SECONDS_IN_DAY` | `SECONDS_IN_DAY` (改为 constant) | 应声明为 constant |
| 49 | `totalMintDuration` | `TOTAL_MINT_DURATION` (改为 constant) | 常量应使用 UPPER_SNAKE_CASE |
| 57 | `baseBurnAmount` | `BASE_BURN_AMOUNT` (改为 constant) | 常量应使用 UPPER_SNAKE_CASE |
| 78 | `meshApplyCount` | `meshClaimCount` | 更准确：这是认领次数，不是申请次数 |
| 81 | `degreeHeats` | `meshHeats` | 更简洁：degree 是冗余的 |
| 110 | `claimMints` | `totalClaimMints` | 更清晰：表示总数 |
| 120 | `treasuryAddr` | `treasuryAddress` | 更完整：使用完整单词 |
| 123 | `governanceSafe` | `governanceSafeAddress` | 更清晰：明确是地址类型 |

#### Reward.sol

| 行号 | 当前命名 | 建议命名 | 说明 |
|------|---------|---------|------|
| 54 | `foundationAddr` | `foundationAddress` | 更完整：使用完整单词 |
| 60 | `governanceSafe` | `governanceSafeAddress` | 更清晰：明确是地址类型 |

#### Stake.sol

| 行号 | 当前命名 | 建议命名 | 说明 |
|------|---------|---------|------|
| 70 | `foundationAddr` | `foundationAddress` | 更完整：使用完整单词 |
| 73 | `governanceSafe` | `governanceSafeAddress` | 更清晰：明确是地址类型 |

#### X402PaymentGateway.sol

| 行号 | 当前命名 | 建议命名 | 说明 |
|------|---------|---------|------|
| 68 | `meshId` | `meshID` | 保持一致性：其他地方使用 `meshID` |
| 101 | `minMeshAmount` | `MIN_MESH_AMOUNT` (改为 constant) | 常量应使用 UPPER_SNAKE_CASE |
| 104 | `maxMeshAmount` | `MAX_MESH_AMOUNT` (改为 constant) | 常量应使用 UPPER_SNAKE_CASE |
| 107 | `minReserveBalance` | `MIN_RESERVE_BALANCE` (改为 constant) | 常量应使用 UPPER_SNAKE_CASE |

---

### 4. 函数参数命名不一致 ⚠️

#### 问题：下划线前缀使用不一致

**当前情况**:
- 大部分函数参数使用 `_` 前缀（如 `_meshID`, `_user`, `_amount`）
- 但有些函数没有使用前缀（如 `getMeshInfo(string calldata _meshID)`）

**建议**: 统一使用下划线前缀表示函数参数，与状态变量区分

**示例**:
```solidity
// ✅ 正确（当前）
function claimMesh(string memory _meshID) external ...
function getUserState(address _user) external view returns (...)

// ⚠️ 需要统一
function getMeshInfo(string calldata _meshID) external view returns (...)  // 已有前缀，正确
```

---

### 5. 事件命名检查 ✅

所有事件命名都符合 `PascalCase` 规范：

- `MeshClaimed` ✅
- `UserWeightUpdated` ✅
- `TokensBurned` ✅
- `ClaimCostBurned` ✅
- `UnclaimedDecayApplied` ✅
- `BurnScaleUpdated` ✅
- `TreasuryAddressUpdated` ✅
- `GovernanceSafeUpdated` ✅
- `GovernanceModeSwitched` ✅
- `GovernanceModeLocked` ✅
- `PaymentProcessed` ✅
- `MeshDistributed` ✅
- `StablecoinConfigUpdated` ✅

---

### 6. 结构体命名检查 ✅

所有结构体命名都符合 `PascalCase` 规范：

- `MintInfo` ✅
- `RewardInfo` ✅
- `StakeInfo` ✅
- `StakeStats` ✅
- `PaymentInfo` ✅
- `StablecoinConfig` ✅
- `RecipientAutoLimit` ✅
- `AutoLimit` ✅
- `QueuedOperation` ✅
- `CheckInRequest` ✅

---

### 7. 修饰符命名检查 ✅

所有修饰符命名都符合 `camelCase` 规范：

- `onlySafe` ✅
- `onlyGovernance` ✅
- `onlyContractOwner` ✅
- `onlyFoundation` ✅
- `hasStake` ✅
- `onlySafeExec` ✅

---

## 命名不准确问题

### 1. 语义不准确

| 合约 | 变量/函数 | 当前命名 | 建议命名 | 原因 |
|------|---------|---------|---------|------|
| Meshes | `meshApplyCount` | 申请次数 | `meshClaimCount` | 实际是认领次数，不是申请次数 |
| Meshes | `degreeHeats` | 热度值 | `meshHeats` | `degree` 是冗余的，`heat` 已足够 |
| Meshes | `claimMints` | 认领次数 | `totalClaimMints` | 更明确表示总数 |
| Meshes | `activeMinters` | 活跃铸币者 | `activeClaimers` | 实际是认领者，不是铸币者 |

### 2. 缩写不一致

| 问题 | 当前使用 | 建议统一为 |
|------|---------|-----------|
| 地址缩写 | `Addr` (treasuryAddr, foundationAddr) | `Address` (treasuryAddress, foundationAddress) |
| ID 大小写 | `meshID` vs `meshId` | `meshID` (全大写) |

---

## 修复优先级

### 🔴 高优先级（必须修复）

1. **函数名大写开头** - `ClaimMesh` → `claimMesh`, `ClaimMeshFor` → `claimMeshFor`
   - 影响: 不符合 Solidity 规范，可能导致前端调用问题
   - 修复难度: 中等（需要更新所有调用处）

### 🟡 中优先级（建议修复）

2. **常量声明** - `SECONDS_IN_DAY` 等应声明为 `constant`
   - 影响: 代码清晰度和 Gas 优化
   - 修复难度: 低

3. **地址变量命名** - `Addr` → `Address`
   - 影响: 代码可读性
   - 修复难度: 低

### 🟢 低优先级（可选优化）

4. **语义准确性** - `meshApplyCount` → `meshClaimCount`
   - 影响: 代码可读性
   - 修复难度: 中等（需要更新所有引用）

5. **常量命名** - 配置常量应使用 `UPPER_SNAKE_CASE`
   - 影响: 代码一致性
   - 修复难度: 低

---

## 修复建议

### 1. 函数名修复（高优先级）

```solidity
// Meshes.sol
// 修复前
function ClaimMesh(string memory _meshID) external ...
function ClaimMeshFor(address _user, string memory _meshID) external ...

// 修复后
function claimMesh(string memory _meshID) external ...
function claimMeshFor(address _user, string memory _meshID) external ...
```

**注意事项**:
- 需要更新所有调用这些函数的地方
- 需要更新前端代码
- 需要更新测试代码
- 需要更新文档

### 2. 常量声明修复（中优先级）

```solidity
// Meshes.sol
// 修复前
uint256 SECONDS_IN_DAY = 86400;
uint256 totalMintDuration = 10 * 365 * SECONDS_IN_DAY;
uint256 baseBurnAmount = 10;

// 修复后
uint256 private constant SECONDS_IN_DAY = 86400;
uint256 private constant TOTAL_MINT_DURATION = 10 * 365 * SECONDS_IN_DAY;
uint256 private constant BASE_BURN_AMOUNT = 10;
```

### 3. 地址变量命名修复（中优先级）

```solidity
// 修复前
address public treasuryAddr;
address public foundationAddr;
address public governanceSafe;

// 修复后
address public treasuryAddress;
address public foundationAddress;
address public governanceSafeAddress;
```

### 4. 语义准确性修复（低优先级）

```solidity
// Meshes.sol
// 修复前
mapping(string => uint32) public meshApplyCount;
mapping(string => uint256) public degreeHeats;
uint256 public claimMints;
uint256 public activeMinters;

// 修复后
mapping(string => uint32) public meshClaimCount;
mapping(string => uint256) public meshHeats;
uint256 public totalClaimMints;
uint256 public activeClaimers;
```

---

## 总结

### 必须修复（高优先级）
- ✅ 2 个函数名以大写开头：`ClaimMesh`, `ClaimMeshFor`

### 建议修复（中优先级）
- ⚠️ 3 个常量未声明为 `constant`：`SECONDS_IN_DAY`, `totalMintDuration`, `baseBurnAmount`
- ⚠️ 多个地址变量使用 `Addr` 缩写：应改为 `Address`

### 可选优化（低优先级）
- 💡 4 个变量命名语义不够准确：`meshApplyCount`, `degreeHeats`, `claimMints`, `activeMinters`
- 💡 配置常量应使用 `UPPER_SNAKE_CASE`

### 已符合规范 ✅
- 事件命名：全部符合 `PascalCase`
- 结构体命名：全部符合 `PascalCase`
- 修饰符命名：全部符合 `camelCase`
- 大部分函数和变量命名：符合 `camelCase`

---

**建议**: 优先修复高优先级问题（函数名大写开头），然后逐步优化中低优先级问题。

