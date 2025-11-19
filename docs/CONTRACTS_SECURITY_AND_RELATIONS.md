# 合約功能與安全分析

此文檔先梳理平行宇宙合約體系的主要責任與調用關係，然後列出在審查中發現的安全風險（含嚴重度與對應代碼片段）。

---

## 一、核心合約與調用關係

### 1. Meshes 代幣系統（`contracts/Meshes.sol`）
- ERC20 代幣以及地理網格認領、權重/燃燒/衰減與提幣邏輯，claim 直接打通 `claimMesh`/`withdraw`。
- 代幣燃燒與 10% Treasury 分配會通過 `pendingTreasuryPool` 累計，並在 `_maybePayoutTreasury` 中按小時轉給 `treasuryAddress`。
- `setTreasuryAddress` 可被治理模式調整，Safe 模式需經由 `MeshesTreasury` 的白名單確認。

### 2. MeshesTreasury → FoundationManage
- `MeshesTreasury.sol` 掌控 Mesh 代幣接收、Safe/Owner 權限、收款白名單、auto-balance 與緊急取回（`balanceFoundationManage`、`transferTo` 相關）。
- `FoundationManage` 被設為白名單接收者，可進一步轉給自動化收款人（`autoTransferTo`）並提供限額/補倉/健康檢查等機制。
- `FoundationManage.emergencyWithdrawToTreasury` 可供 Treasury 在恐慌時拉回資金，並且 `MeshesTreasury` 也可 `call` 這個函數（`contracts/MeshesTreasury.sol:268-286`）。

### 3. 消費/用戶端合約
- `Reward`（`contracts/Reward.sol`）與 `Stake`（`contracts/Stake.sol`）透過 `_ensureTopUp` 向 `FoundationManage` 請求補充，並只能在 Safe/財務 Safe 下管理參數。
- `X402PaymentGateway` 由穩定幣支付觸發 `FoundationManage.autoTransferTo`，成功後可選擇自動呼叫 `meshesContract.claimMesh`；若提供 `meshId`，網關會將認領動作以自己的 `msg.sender` 對 `Meshes` 找申請。

### 4. Safe 自動化執行器
- `SafeManager` 負責 Safe 操作提議與執行，只允許 `safeAddress` 呼叫 `executeOperation`。
- `AutomatedExecutor` 透過 `queueOperation` 與 `executeBatch` 管理待辦操作，最後呼叫 `SafeManager.executeOperation` 來觸發多簽指令。
- `CheckInVerifier` 提供合約驗證活動資格，Reward 透過介面引用其 `isEligible`。

### 5. 前端/使用者流程
- `management` 端透過 `ContractOperationsPanel`、`EnhancedFunctionExecuteDialog` 統一暴露函數，公開函數直接用瀏覽器錢包執行、需要 Safe 的會走 `SafeContractCaller`。
- Meshes-web 使 `ClaimDialog` 提供兩種支付模式：Wallet 直接呼叫 `claimMint` → `claimMesh`；X402 則先完成穩定幣流程，但成功後仍需用戶手動再次確認調用 `claimMint`（以自身帳戶發送）。

---

## 二、安全分析

| 風險 | 描述 | 嚴重度 |
| --- | --- | --- |
| 1. AutomatedExecutor 無法實際觸發 Safe 操作 | `executeBatch` 採用 `try this.executeSingleOperation`，此時呼叫者是合約自身，故 `onlyExecutor`（`AutomationSafe`）通過，但 `SafeManager.executeOperation` 要求 `msg.sender == safeAddress`（`contracts/SafeManager.sol:169-186`）而不是 AutomatedExecutor，因此即使 Batch 成功也無法做任何 SafeCall，重試邏輯反而把未執行的操作標記為 `executed`，導致自動化程式面臨機制失效或錯失緊急操作。 | 高 |
| 2. 自動化隊列清理導致未執行操作刪除 | `_cleanupExecutedOperations` 在迴圈中 `operationQueue[i] = operationQueue[operationQueue.length - 1]; operationQueue.pop(); delete queuedOperations[operationQueue[i]];`（`contracts/AutomatedExecutor.sol:317-325`）會把剛交換進 `i` 位置的 operation 也誤刪，出現索引跳過且映射被刪除的狀況，隊列可能無聲無息丟失待執行項目。 | 中 |
| 3. `_getOperationType` 固定回傳 `MESH_CLAIM`，所有執行規則共用相同限頻、Gas 上限 | `executionRules` 無法依據真實 `opType` 區分，部分敏感操作（如 `REWARD_SET`）無法設定長冷卻時間，降低預期的風控效果（`contracts/AutomatedExecutor.sol:265-295`）。 | 中 |
| 4. X402PaymentGateway 自動 Claim 會使用網關地址作為 `msg.sender` | 合約 `processPayment` 成功後執行 `meshesContract.claimMesh`（`contracts/X402PaymentGateway.sol:256-266`），但 `Meshes.claimMesh` 會把 `msg.sender` 記為認領者、更新其 `userWeightSum`、將所有 future reward 指向網關，導致用戶既無法提取網格收益又無法再續 claim；任何使用該合約接口的第三方都會蓄意/誤發起這類操作。 | 高 |

### 建議 ✅ 已全部實施（2025-11-13）

1. ✅ **已修復**: 重新設計 AutomatedExecutor 與 SafeManager 的互動，在 SafeManager 中加入可信任執行者（Trusted Executor）機制，允許 Safe 自己透過 Safe App 觸發 `executeOperation`，或授權 AutomatedExecutor 執行。已禁止 `AutomatedExecutor` 添加高風險操作（REWARD_SET, EMERGENCY_PAUSE, EMERGENCY_RESUME），避免 Batch 失敗隱蔽。
2. ✅ **已修復**: 修正隊列清理對映射的刪除邏輯，通過先儲存 `bytes32 id = operationQueue[i];`，pop 後再 `delete queuedOperations[id];`，避免刪除新加入的項目。
3. ✅ **已修復**: 將 `_getOperationType` 改為查詢 `SafeManager.operations[_operationId].opType`，以便 `executionRules` 可以對不同類型的任務設定不同冷卻與 Gas 限額。
4. ✅ **已修復**: 禁用 `X402PaymentGateway` 內的 `meshesContract.claimMesh` 呼叫，改由前端提供 Claim 按鈕。同時在 Meshes 合約中新增 `claimMeshFor(address user, string meshId)` 接口（僅限治理地址），作為可選方案。

---

## 三、安全修復實施詳情

### 1. ✅ AutomatedExecutor 與 SafeManager 交互修復

**問題描述**: `AutomatedExecutor.executeBatch` 採用 `try this.executeSingleOperation`，此時調用者是合約自身，`onlyExecutor` 通過，但 `SafeManager.executeOperation` 要求 `msg.sender == safeAddress`，導致無法執行任何 SafeCall。

**修復方案**: 在 `SafeManager` 中添加可信任執行者（Trusted Executor）機制：
- 添加 `trustedExecutors` 映射
- 修改 `onlySafe` 修飾符，允許可信任執行者
- 添加 `setTrustedExecutor()` 函數

**使用說明**: Safe 可以通過 `setTrustedExecutor(automatedExecutorAddress, true)` 授權 `AutomatedExecutor` 執行操作。

### 2. ✅ 隊列清理邏輯修復

**問題描述**: `_cleanupExecutedOperations` 在循環中會誤刪剛交換進 `i` 位置的 operation，導致索引跳過且映射被刪除。

**修復方案**: 先保存 `operationId`，pop 後再 delete：
```solidity
bytes32 operationId = operationQueue[i];  // 先保存
operationQueue[i] = operationQueue[operationQueue.length - 1];
operationQueue.pop();
delete queuedOperations[operationId];  // pop 後再刪除
```

### 3. ✅ `_getOperationType` 修復

**問題描述**: `_getOperationType` 固定返回 `MESH_CLAIM`，所有執行規則共用相同限頻、Gas 上限。

**修復方案**: 改為查詢 `SafeManager.operations[_operationId].opType`，確保不同操作類型使用不同的執行規則。

### 4. ✅ X402PaymentGateway 自動 Claim 修復

**問題描述**: `X402PaymentGateway.processPayment` 成功後執行 `meshesContract.claimMesh`，但 `Meshes.claimMesh` 會把 `msg.sender` 記為認領者，導致網格歸屬落在網關合約身上。

**修復方案**: 
- 禁用自動 Claim，改由前端提供 Claim 按鈕
- 添加 `claimMeshFor(address user, string meshId)` 接口（僅限治理地址），作為可選方案

### 5. ✅ 高風險操作限制

**新增功能**: 在 `AutomatedExecutor` 中添加高風險操作限制機制：
- 添加 `highRiskOperations` 映射
- 在 `queueOperation` 中檢查並阻止高風險操作
- 支持管理函數動態調整

---

## 四、總結
此體系由 Meshes 代幣、Treasury、FoundationManage、各類消費/獎勵合約，以及 Safe + 自動化層構成；前端/管理端提供直接錢包或 Safe 兩種操作通路。

**安全狀態更新（2025-11-13）**: 
- ✅ 所有識別的高風險問題已修復
- ✅ Safe 自動化執行機制已修復（可信任執行者支持）
- ✅ X402 自動 Claim 問題已修復（改為用戶手動 Claim）
- ✅ 隊列清理邏輯已修復
- ✅ 操作類型識別已修復

**後續建議**: 
- 進行完整的安全審計
- 編寫並運行完整的測試套件
- 更新前端文檔，說明新的 Claim 流程
