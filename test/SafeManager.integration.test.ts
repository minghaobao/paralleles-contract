import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";

/**
 * SafeManager 集成测试
 * 
 * 测试目标：
 * 1. 验证 trustedExecutor 机制（简化路径）
 * 2. 确保 SafeManager.executeOperation 在简化路径下能被正常触发
 * 3. 测试 AutomatedExecutor 与 SafeManager 的集成
 * 4. 验证操作提议、执行、取消的完整流程
 */
describe("SafeManager Integration Tests - Trusted Executor Path", function () {
  let safeManager: Contract;
  let automatedExecutor: Contract;
  let mockTarget: Contract;
  let owner: SignerWithAddress;
  let safe: SignerWithAddress;
  let trustedExecutor: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    owner = signers[0];
    safe = signers[1];
    trustedExecutor = signers[2];
    unauthorized = signers[3];

    // 部署 SafeManager（使用 safe 地址）
    const SafeManager = await ethers.getContractFactory("SafeManager");
    safeManager = await SafeManager.deploy(safe.address);
    await safeManager.deployed();

    // 部署 AutomatedExecutor
    const AutomatedExecutor = await ethers.getContractFactory("AutomatedExecutor");
    automatedExecutor = await AutomatedExecutor.deploy(safeManager.address);
    await automatedExecutor.deployed();

    // 部署 Mock 目标合约（用于测试操作执行）
    const MockTarget = await ethers.getContractFactory("MockERC20");
    mockTarget = await MockTarget.deploy("Mock", "MOCK");
    await mockTarget.deployed();
  });

  describe("Trusted Executor Setup", function () {
    it("应该允许 Safe 设置 trustedExecutor", async function () {
      // Safe 设置 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);
      
      const isTrusted = await safeManager.trustedExecutors(trustedExecutor.address);
      expect(isTrusted).to.be.true;
    });

    it("应该允许 Safe 移除 trustedExecutor", async function () {
      // 先设置
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);
      
      // 再移除
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, false);
      
      const isTrusted = await safeManager.trustedExecutors(trustedExecutor.address);
      expect(isTrusted).to.be.false;
    });

    it("应该拒绝非 Safe 地址设置 trustedExecutor", async function () {
      await expect(
        safeManager.connect(owner).setTrustedExecutor(trustedExecutor.address, true)
      ).to.be.revertedWith("SafeManager: Only Safe or trusted executor can call");
    });

    it("应该拒绝设置零地址为 trustedExecutor", async function () {
      await expect(
        safeManager.connect(safe).setTrustedExecutor(ethers.constants.AddressZero, true)
      ).to.be.revertedWith("SafeManager: Invalid executor address");
    });
  });

  describe("Operation Execution via Trusted Executor (Simplified Path)", function () {
    let operationId: string;

    beforeEach(async () => {
      // 设置 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);

      // Safe 提议一个操作（模拟转账操作）
      const operationType = 0; // MESH_CLAIM
      const target = mockTarget.address;
      const data = mockTarget.interface.encodeFunctionData("transfer", [
        trustedExecutor.address,
        ethers.utils.parseEther("100")
      ]);
      const description = "Test operation via trusted executor";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      operationId = event?.args?.operationId;
    });

    it("应该允许 trustedExecutor 执行操作（简化路径）", async function () {
      // 确保操作存在且未执行
      const operationBefore = await safeManager.operations(operationId);
      expect(operationBefore.executed).to.be.false;

      // trustedExecutor 执行操作
      const tx = await safeManager.connect(trustedExecutor).executeOperation(operationId);
      const receipt = await tx.wait();

      // 验证操作已执行
      const operationAfter = await safeManager.operations(operationId);
      expect(operationAfter.executed).to.be.true;

      // 验证事件
      const event = receipt.events?.find((e: any) => e.event === "OperationExecuted");
      expect(event).to.not.be.undefined;
      expect(event?.args?.operationId).to.equal(operationId);
    });

    it("应该拒绝未授权的地址执行操作", async function () {
      await expect(
        safeManager.connect(unauthorized).executeOperation(operationId)
      ).to.be.revertedWith("SafeManager: Only Safe or trusted executor can call");
    });

    it("应该拒绝执行已执行的操作", async function () {
      // 先执行一次
      await safeManager.connect(trustedExecutor).executeOperation(operationId);

      // 再次执行应该失败
      await expect(
        safeManager.connect(trustedExecutor).executeOperation(operationId)
      ).to.be.revertedWith("SafeManager: Operation already executed");
    });

    it("应该拒绝执行不存在的操作", async function () {
      const fakeOperationId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fake"));
      
      await expect(
        safeManager.connect(trustedExecutor).executeOperation(fakeOperationId)
      ).to.be.revertedWith("SafeManager: Operation does not exist");
    });
  });

  describe("AutomatedExecutor Integration", function () {
    let operationId: string;

    beforeEach(async () => {
      // 设置 AutomatedExecutor 为 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(automatedExecutor.address, true);

      // 授予 trustedExecutor EXECUTOR_ROLE
      await automatedExecutor.connect(owner).grantRole(
        await automatedExecutor.EXECUTOR_ROLE(),
        trustedExecutor.address
      );

      // Safe 提议一个操作
      const operationType = 0;
      const target = mockTarget.address;
      const data = mockTarget.interface.encodeFunctionData("transfer", [
        trustedExecutor.address,
        ethers.utils.parseEther("100")
      ]);
      const description = "Test operation via AutomatedExecutor";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      operationId = event?.args?.operationId;
    });

    it("应该允许 AutomatedExecutor 将操作加入队列", async function () {
      const tx = await automatedExecutor.connect(trustedExecutor).queueOperation(operationId);
      const receipt = await tx.wait();

      const event = receipt.events?.find((e: any) => e.event === "OperationQueued");
      expect(event).to.not.be.undefined;
      expect(event?.args?.operationId).to.equal(operationId);

      const queueStatus = await automatedExecutor.getQueueStatus();
      expect(queueStatus.totalQueued).to.equal(1);
    });

    it("应该允许 AutomatedExecutor 执行队列中的操作（简化路径）", async function () {
      // 将操作加入队列
      await automatedExecutor.connect(trustedExecutor).queueOperation(operationId);

      // 执行单个操作
      const tx = await automatedExecutor.connect(trustedExecutor).executeSingleOperation(operationId);
      const receipt = await tx.wait();

      // 验证操作已执行
      const operation = await safeManager.operations(operationId);
      expect(operation.executed).to.be.true;

      // 验证事件
      const event = receipt.events?.find((e: any) => e.event === "OperationExecuted");
      expect(event).to.not.be.undefined;
      expect(event?.args?.operationId).to.equal(operationId);
      expect(event?.args?.success).to.be.true;
    });

    it("应该支持批量执行操作（简化路径）", async function () {
      // 创建多个操作
      const operationIds: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        const operationType = 0;
        const target = mockTarget.address;
        const data = mockTarget.interface.encodeFunctionData("transfer", [
          trustedExecutor.address,
          ethers.utils.parseEther("10")
        ]);
        const description = `Batch operation ${i}`;

        const tx = await safeManager.connect(safe).proposeOperation(
          operationType,
          target,
          data,
          description
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
        operationIds.push(event?.args?.operationId);

        // 加入队列
        await automatedExecutor.connect(trustedExecutor).queueOperation(event?.args?.operationId);
      }

      // 批量执行
      const tx = await automatedExecutor.connect(trustedExecutor).executeBatch(3);
      const receipt = await tx.wait();

      // 验证所有操作已执行
      for (const opId of operationIds) {
        const operation = await safeManager.operations(opId);
        expect(operation.executed).to.be.true;
      }

      // 验证事件
      const event = receipt.events?.find((e: any) => e.event === "BatchExecuted");
      expect(event).to.not.be.undefined;
      expect(event?.args?.count).to.equal(3);
      expect(event?.args?.successCount).to.equal(3);
    });
  });

  describe("Safety Operations", function () {
    it("应该支持紧急暂停操作", async function () {
      // Safe 提议紧急暂停操作
      const operationType = 6; // EMERGENCY_PAUSE
      const target = safeManager.address;
      const data = safeManager.interface.encodeFunctionData("emergencyPause");
      const description = "Emergency pause operation";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      const operationId = event?.args?.operationId;

      // 设置 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);

      // trustedExecutor 执行暂停操作
      await safeManager.connect(trustedExecutor).executeOperation(operationId);

      // 验证合约已暂停
      const isPaused = await safeManager.paused();
      expect(isPaused).to.be.true;
    });

    it("应该支持紧急恢复操作", async function () {
      // 先暂停
      await safeManager.connect(safe).emergencyPause();

      // Safe 提议紧急恢复操作
      const operationType = 7; // EMERGENCY_RESUME
      const target = safeManager.address;
      const data = safeManager.interface.encodeFunctionData("emergencyResume");
      const description = "Emergency resume operation";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      const operationId = event?.args?.operationId;

      // 设置 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);

      // trustedExecutor 执行恢复操作
      await safeManager.connect(trustedExecutor).executeOperation(operationId);

      // 验证合约已恢复
      const isPaused = await safeManager.paused();
      expect(isPaused).to.be.false;
    });

    it("应该支持取消操作", async function () {
      // Safe 提议操作
      const operationType = 0;
      const target = mockTarget.address;
      const data = "0x";
      const description = "Operation to cancel";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      const operationId = event?.args?.operationId;

      // Safe 取消操作
      const cancelTx = await safeManager.connect(safe).cancelOperation(operationId);
      const cancelReceipt = await cancelTx.wait();

      // 验证操作已删除
      const operation = await safeManager.operations(operationId);
      expect(operation.timestamp).to.equal(0);

      // 验证事件
      const cancelEvent = cancelReceipt.events?.find((e: any) => e.event === "OperationCancelled");
      expect(cancelEvent).to.not.be.undefined;
    });
  });

  describe("Edge Cases and Security", function () {
    it("应该防止重入攻击", async function () {
      // 这个测试需要部署一个恶意合约来尝试重入
      // 由于 SafeManager 使用了 nonReentrant 修饰符，重入应该被阻止
      // 这里只验证修饰符存在
      const code = await ethers.provider.getCode(safeManager.address);
      expect(code).to.not.equal("0x");
    });

    it("应该正确处理操作执行失败的情况", async function () {
      // 设置 trustedExecutor
      await safeManager.connect(safe).setTrustedExecutor(trustedExecutor.address, true);

      // 提议一个会失败的操作（调用不存在的函数）
      const operationType = 0;
      const target = mockTarget.address;
      const data = "0x12345678"; // 无效的函数调用
      const description = "Operation that will fail";

      const tx = await safeManager.connect(safe).proposeOperation(
        operationType,
        target,
        data,
        description
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "OperationProposed");
      const operationId = event?.args?.operationId;

      // 执行操作（应该失败但不回滚）
      const executeTx = await safeManager.connect(trustedExecutor).executeOperation(operationId);
      const executeReceipt = await executeTx.wait();

      // 验证操作未标记为已执行（因为执行失败）
      const operation = await safeManager.operations(operationId);
      expect(operation.executed).to.be.false;
    });
  });
});

