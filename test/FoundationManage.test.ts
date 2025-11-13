import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("FoundationManage.sol", function () {
  let token: any;
  let treasury: any;
  let foundationManage: any;
  let owner: any;
  let safe: any;
  let initiatorA: any;
  let recipientB: any;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    owner = signers[0];
    safe = signers[1] || signers[0];
    initiatorA = signers[2] || signers[0];
    recipientB = signers[3] || signers[0];

    // 部署 Mock ERC20 代币
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Mock", "MOCK");
    await token.deployed();

    // 部署 MeshesTreasury
    const MeshesTreasury = await ethers.getContractFactory("MeshesTreasury");
    treasury = await MeshesTreasury.deploy(safe.address);
    await treasury.deployed();

    // 设置 Treasury 的代币地址
    await treasury.connect(owner).setMeshToken(token.address);

    // 部署 FoundationManage
    const FoundationManage = await ethers.getContractFactory("FoundationManage");
    foundationManage = await FoundationManage.deploy(treasury.address);
    await foundationManage.deployed();

    // 设置 FoundationManage 的代币地址
    await foundationManage.connect(owner).setMeshToken(token.address);

    // 向 Treasury 充值
    await token.mint(treasury.address, ethers.utils.parseEther("100000"));

    // 将 FoundationManage 添加到 Treasury 的收款白名单
    await treasury.connect(owner).setRecipient(foundationManage.address, true);

    // 通过 Safe 从 Treasury 转账到 FoundationManage（模拟资金池）
    await treasury.connect(safe).transferTo(foundationManage.address, ethers.utils.parseEther("50000"));

    // 批准发起方和收款方
    await foundationManage.connect(owner).setInitiator(initiatorA.address, true);
    await foundationManage.connect(owner).setAutoRecipient(recipientB.address, true);
  });

  it("autoTransferTo enforces per-tx and daily limits", async () => {
    // 设置发起方限额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("10"), 
      ethers.utils.parseEther("50"), 
      true
    );

    // 设置收款方限额
    await foundationManage.connect(owner).setAutoRecipientLimit(
      recipientB.address,
      ethers.utils.parseEther("10"),
      ethers.utils.parseEther("50"),
      true
    );

    // 设置全局限额
    await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100"));
    await foundationManage.connect(owner).setGlobalAutoEnabled(true);

    // 测试超过单笔限额
    try {
      await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("11"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("per-tx");
    }

    // 在限额内多次转账直到超过每日限额
    await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("10"));
    await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("10"));
    await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("10"));
    await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("10"));
    await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("10"));

    // 测试超过每日限额
    try {
      await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("daily limit");
    }
  });

  it("insufficient balance reverts", async () => {
    // 设置限额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("1000"), 
      ethers.utils.parseEther("1000"), 
      true
    );
    await foundationManage.connect(owner).setAutoRecipientLimit(
      recipientB.address,
      ethers.utils.parseEther("1000"),
      ethers.utils.parseEther("1000"),
      true
    );
    await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100000"));
    await foundationManage.connect(owner).setGlobalAutoEnabled(true);

    // 转走 FoundationManage 的所有余额（通过自动转账）
    const bal = await token.balanceOf(foundationManage.address);
    // 更新限额以便能转走所有余额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("1000"), 
      ethers.utils.parseEther("100000"), 
      true
    );
    await foundationManage.connect(owner).setAutoRecipientLimit(
      recipientB.address,
      ethers.utils.parseEther("1000"),
      ethers.utils.parseEther("100000"),
      true
    );
    // 分多次转账清空余额
    let remaining = bal;
    const perTx = ethers.utils.parseEther("1000");
    while (remaining.gt(0)) {
      const toTransfer = remaining.gt(perTx) ? perTx : remaining;
      await foundationManage.connect(initiatorA).autoTransferTo(
        recipientB.address,
        toTransfer
      );
      remaining = remaining.sub(toTransfer);
    }

    // 尝试转账应该失败
    try {
      await foundationManage.connect(initiatorA).autoTransferTo(recipientB.address, ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("insufficient");
    }
  });

  it("only approved initiator can auto transfer", async () => {
    // 设置限额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("10"), 
      ethers.utils.parseEther("50"), 
      true
    );
    await foundationManage.connect(owner).setAutoRecipientLimit(
      recipientB.address,
      ethers.utils.parseEther("10"),
      ethers.utils.parseEther("50"),
      true
    );
    await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100"));
    await foundationManage.connect(owner).setGlobalAutoEnabled(true);

    // 未批准的发起方应该失败
    const unapprovedInitiator = await ethers.getSigner(4);
    try {
      await foundationManage.connect(unapprovedInitiator).autoTransferTo(recipientB.address, ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("initiator not approved");
    }
  });

  it("only approved recipient can receive auto transfer", async () => {
    // 设置限额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("10"), 
      ethers.utils.parseEther("50"), 
      true
    );
    await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100"));
    await foundationManage.connect(owner).setGlobalAutoEnabled(true);

    // 未批准的收款方应该失败
    const unapprovedRecipient = await ethers.getSigner(4);
    try {
      await foundationManage.connect(initiatorA).autoTransferTo(unapprovedRecipient.address, ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("auto recipient not approved");
    }
  });

  it("owner can set limits and whitelists", async () => {
    const newInitiator = await ethers.getSigner(4);
    const newRecipient = await ethers.getSigner(5);

    // 设置发起方
    await foundationManage.connect(owner).setInitiator(newInitiator.address, true);
    expect(await foundationManage.isInitiatorApproved(newInitiator.address)).to.equal(true);

    // 设置收款方
    await foundationManage.connect(owner).setAutoRecipient(newRecipient.address, true);
    expect(await foundationManage.isAutoRecipientApproved(newRecipient.address)).to.equal(true);

    // 设置限额
    await foundationManage.connect(owner).setAutoLimit(
      newInitiator.address,
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("500"),
      true
    );

    const limit = await foundationManage.autoLimits(newInitiator.address);
    expect(limit.maxPerTx).to.equal(ethers.utils.parseEther("100"));
    expect(limit.maxDaily).to.equal(ethers.utils.parseEther("500"));
    expect(limit.enabled).to.equal(true);
  });

  it("auto transfer with reason ID", async () => {
    // 设置限额
    await foundationManage.connect(owner).setAutoLimit(
      initiatorA.address, 
      ethers.utils.parseEther("10"), 
      ethers.utils.parseEther("50"), 
      true
    );
    await foundationManage.connect(owner).setAutoRecipientLimit(
      recipientB.address,
      ethers.utils.parseEther("10"),
      ethers.utils.parseEther("50"),
      true
    );
    await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100"));
    await foundationManage.connect(owner).setGlobalAutoEnabled(true);

    const reasonId = ethers.utils.formatBytes32String("REWARD_PAYOUT");
    const balBefore = await token.balanceOf(recipientB.address);
    
    await foundationManage.connect(initiatorA).autoTransferToWithReason(
      recipientB.address, 
      ethers.utils.parseEther("5"), 
      reasonId
    );
    
    const balAfter = await token.balanceOf(recipientB.address);
    expect(balAfter.sub(balBefore).eq(ethers.utils.parseEther("5"))).to.equal(true);
  });

  // ============ 新增功能测试（来自 V2） ============
  
  describe("合约初始化（增强）", function () {
    it("应该正确设置余额阈值", async function () {
      await foundationManage.connect(owner).setBalanceThresholds(
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("10000")
      );
      expect(await foundationManage.minBalance()).to.equal(ethers.utils.parseEther("1000"));
      expect(await foundationManage.maxBalance()).to.equal(ethers.utils.parseEther("10000"));
    });
  });

  describe("合约就绪检查", function () {
    it("isReady 应该返回 true", async function () {
      await foundationManage.connect(owner).setBalanceThresholds(
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("10000")
      );
      expect(await foundationManage.isReady()).to.equal(true);
    });

    it("healthCheck 应该返回 HEALTHY 状态", async function () {
      await foundationManage.connect(owner).setBalanceThresholds(
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("10000")
      );
      await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("1000"));
      await foundationManage.connect(owner).setGlobalAutoEnabled(true);
      
      const result = await foundationManage.healthCheck();
      expect(result.status).to.equal("HEALTHY");
      expect(result.isInitialized).to.equal(true);
      expect(result.hasSufficientBalance).to.equal(true);
      expect(result.limitsConfigured).to.equal(true);
    });
  });

  describe("自动补充机制", function () {
    beforeEach(async function () {
      await foundationManage.connect(owner).setBalanceThresholds(
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("10000")
      );
      await foundationManage.connect(owner).setAutoLimit(
        initiatorA.address,
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("50000"),
        true
      );
      await foundationManage.connect(owner).setAutoRecipientLimit(
        recipientB.address,
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("50000"),
        true
      );
      await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("100000"));
      await foundationManage.connect(owner).setGlobalAutoEnabled(true);
      await foundationManage.connect(owner).setAutoRefillConfig(true, 10);
    });

    it("应该能够手动请求补充", async function () {
      const targetBalance = ethers.utils.parseEther("500");
      const currentBalance = await token.balanceOf(foundationManage.address);
      const totalToTransfer = currentBalance.sub(targetBalance);
      const perTxMax = ethers.utils.parseEther("1000");
      
      let remaining = totalToTransfer;
      while (remaining.gt(0)) {
        const toTransfer = remaining.gt(perTxMax) ? perTxMax : remaining;
        await foundationManage.connect(initiatorA).autoTransferTo(
          recipientB.address,
          toTransfer
        );
        remaining = remaining.sub(toTransfer);
        await ethers.provider.send("evm_increaseTime", [11]);
        await ethers.provider.send("evm_mine", []);
      }

      const user1 = await ethers.getSigner(4);
      const tx = await foundationManage.connect(user1).requestRefill(0);
      await expect(tx).to.emit(foundationManage, "RefillRequested");
    });

    it("应该拒绝余额充足时的补充请求", async function () {
      const user1 = await ethers.getSigner(4);
      await expect(
        foundationManage.connect(user1).requestRefill(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("FoundationManage: balance sufficient");
    });
  });

  describe("紧急提取功能", function () {
    beforeEach(async function () {
      await treasury.connect(owner).setFoundationManage(foundationManage.address);
    });

    it("应该允许 Treasury 在暂停时紧急提取", async function () {
      await foundationManage.connect(owner).pause();
      const balanceBefore = await token.balanceOf(treasury.address);
      const foundationBalance = await token.balanceOf(foundationManage.address);
      await treasury.connect(safe).emergencyWithdrawFromFoundation(0);
      const balanceAfter = await token.balanceOf(treasury.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(foundationBalance);
    });

    it("应该拒绝非 Treasury 的紧急提取", async function () {
      await foundationManage.connect(owner).pause();
      const user1 = await ethers.getSigner(4);
      await expect(
        foundationManage.connect(user1).emergencyWithdrawToTreasury(0)
      ).to.be.revertedWith("FoundationManage: only treasury");
    });
  });

  describe("余额监控", function () {
    beforeEach(async function () {
      await foundationManage.connect(owner).setBalanceThresholds(
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("10000")
      );
    });

    it("checkBalanceStatus 应该正确报告状态", async function () {
      const result = await foundationManage.checkBalanceStatus();
      expect(result.isLow).to.equal(false);
      expect(result.isHigh).to.equal(true);
    });
  });

  describe("可用额度查询", function () {
    it("应该正确返回发起方可用额度", async function () {
      await foundationManage.connect(owner).setAutoLimit(
        initiatorA.address,
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("500"),
        true
      );
      await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("1000"));
      await foundationManage.connect(owner).setGlobalAutoEnabled(true);
      
      const available = await foundationManage.getAvailableAutoLimit(initiatorA.address);
      expect(available).to.equal(ethers.utils.parseEther("500"));
    });

    it("应该正确返回全局可用额度", async function () {
      await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("1000"));
      await foundationManage.connect(owner).setGlobalAutoEnabled(true);
      
      const available = await foundationManage.getAvailableGlobalLimit();
      expect(available).to.equal(ethers.utils.parseEther("1000"));
    });
  });
});
