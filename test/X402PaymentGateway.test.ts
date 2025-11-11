import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { X402PaymentGateway } from "../typechain-types/X402PaymentGateway";
import { Meshes } from "../typechain-types/Meshes";
import { FoundationManage } from "../typechain-types/FoundationManage";
import { MockERC20 } from "../typechain-types/contracts/test/MockERC20";

describe("X402PaymentGateway", function () {
  let gateway: X402PaymentGateway;
  let meshes: Meshes;
  let foundationManage: FoundationManage;
  let meshToken: MockERC20;
  let stablecoin: MockERC20; // USDT/USDC模拟
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let verifier: SignerWithAddress; // X402验证地址

  const MESH_INITIAL_SUPPLY = ethers.utils.parseEther("1000000"); // 1M MESH
  const STABLECOIN_INITIAL_SUPPLY = ethers.utils.parseEther("1000000"); // 1M稳定币

  beforeEach(async function () {
    [owner, user, verifier] = await ethers.getSigners();

    // 部署Mock MESH代币
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    meshToken = await MockERC20Factory.deploy("Mesh Token", "MESH", MESH_INITIAL_SUPPLY);
    await meshToken.deployed();

    // 部署稳定币Mock
    stablecoin = await MockERC20Factory.deploy("USDT", "USDT", STABLECOIN_INITIAL_SUPPLY);
    await stablecoin.deployed();

    // 部署Meshes合约（简化版本，仅用于测试）
    // 注意：这里需要实际的Meshes合约，或者使用Mock
    // 为了测试，我们假设Meshes合约已经部署
    const MeshesFactory = await ethers.getContractFactory("Meshes");
    meshes = await MeshesFactory.deploy();
    await meshes.deployed();

    // 部署FoundationManage
    const FoundationManageFactory = await ethers.getContractFactory("FoundationManage");
    foundationManage = await FoundationManageFactory.deploy();
    await foundationManage.deployed();

    // 初始化FoundationManage
    await foundationManage.initialize(meshToken.address, owner.address);

    // 转移MESH到FoundationManage
    await meshToken.transfer(foundationManage.address, MESH_INITIAL_SUPPLY);

    // 部署X402PaymentGateway
    const GatewayFactory = await ethers.getContractFactory("X402PaymentGateway");
    gateway = await GatewayFactory.deploy(
      meshToken.address,
      meshes.address,
      foundationManage.address,
      verifier.address
    );
    await gateway.deployed();

    // 配置稳定币汇率：1 USDT = 1000 MESH
    const rate = ethers.utils.parseEther("1000");
    await gateway.setStablecoinConfig(stablecoin.address, rate, true);
  });

  describe("Deployment", function () {
    it("Should set correct initial values", async function () {
      expect(await gateway.meshToken()).to.equal(meshToken.address);
      expect(await gateway.meshesContract()).to.equal(meshes.address);
      expect(await gateway.foundationManage()).to.equal(foundationManage.address);
      expect(await gateway.x402Verifier()).to.equal(verifier.address);
    });

    it("Should have default limits", async function () {
      expect(await gateway.minMeshAmount()).to.equal(ethers.utils.parseEther("100"));
      expect(await gateway.maxMeshAmount()).to.equal(ethers.utils.parseEther("1000000"));
    });
  });

  describe("Stablecoin Configuration", function () {
    it("Should allow owner to set stablecoin config", async function () {
      const newRate = ethers.utils.parseEther("2000");
      await gateway.setStablecoinConfig(stablecoin.address, newRate, false);

      const config = await gateway.stablecoins(stablecoin.address);
      expect(config.rate).to.equal(newRate);
      expect(config.enabled).to.be.false;
    });

    it("Should not allow non-owner to set stablecoin config", async function () {
      const newRate = ethers.utils.parseEther("2000");
      await expect(
        gateway.connect(user).setStablecoinConfig(stablecoin.address, newRate, false)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Payment Processing", function () {
    it("Should process payment and distribute MESH", async function () {
      const paymentAmount = ethers.utils.parseEther("100"); // 100 USDT
      const expectedMesh = ethers.utils.parseEther("100000"); // 100 * 1000 = 100,000 MESH
      const meshId = "E123N45";
      const nonce = 1;
      const timestamp = Math.floor(Date.now() / 1000);

      // 生成签名
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "string", "uint256", "uint256"],
          [
            gateway.address,
            user.address,
            stablecoin.address,
            paymentAmount,
            meshId,
            nonce,
            timestamp,
          ]
        )
      );
      const signedMessage = await verifier.signMessage(ethers.utils.arrayify(messageHash));
      
      // 处理支付
      await gateway.processPayment(
        user.address,
        stablecoin.address,
        paymentAmount,
        meshId,
        nonce,
        timestamp,
        signedMessage
      );

      // 检查MESH余额
      const userBalance = await meshToken.balanceOf(user.address);
      expect(userBalance).to.equal(expectedMesh);

      // 检查支付记录
      const paymentId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256", "string", "uint256", "uint256"],
          [user.address, stablecoin.address, paymentAmount, meshId, nonce, timestamp]
        )
      );
      const payment = await gateway.payments(paymentId);
      expect(payment.processed).to.be.true;
      expect(payment.meshAmount).to.equal(expectedMesh);
    });

    it("Should reject duplicate payment (same nonce)", async function () {
      const paymentAmount = ethers.utils.parseEther("100");
      const meshId = "E123N45";
      const nonce = 2;
      const timestamp = Math.floor(Date.now() / 1000);

      // 生成签名并处理第一次支付
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "string", "uint256", "uint256"],
          [
            gateway.address,
            user.address,
            stablecoin.address,
            paymentAmount,
            meshId,
            nonce,
            timestamp,
          ]
        )
      );
      const signedMessage = await verifier.signMessage(ethers.utils.arrayify(messageHash));

      await gateway.processPayment(
        user.address,
        stablecoin.address,
        paymentAmount,
        meshId,
        nonce,
        timestamp,
        signedMessage
      );

      // 尝试重复处理同一支付
      await expect(
        gateway.processPayment(
          user.address,
          stablecoin.address,
          paymentAmount,
          meshId,
          nonce,
          timestamp,
          signedMessage
        )
      ).to.be.revertedWith("Nonce already used");
    });

    it("Should reject invalid signature", async function () {
      const paymentAmount = ethers.utils.parseEther("100");
      const meshId = "E123N45";
      const nonce = 3;
      const timestamp = Math.floor(Date.now() / 1000);

      // 使用错误的签名者签名
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "string", "uint256", "uint256"],
          [
            gateway.address,
            user.address,
            stablecoin.address,
            paymentAmount,
            meshId,
            nonce,
            timestamp,
          ]
        )
      );
      const wrongSignedMessage = await user.signMessage(ethers.utils.arrayify(messageHash));

      await expect(
        gateway.processPayment(
          user.address,
          stablecoin.address,
          paymentAmount,
          meshId,
          nonce,
          timestamp,
          wrongSignedMessage
        )
      ).to.be.revertedWith("Invalid payment signature");
    });
  });

  describe("Amount Limits", function () {
    it("Should reject payment below minimum", async function () {
      const paymentAmount = ethers.utils.parseEther("0.01"); // 太小，会导致MESH < minMeshAmount
      const meshId = "";
      const nonce = 4;
      const timestamp = Math.floor(Date.now() / 1000);

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "string", "uint256", "uint256"],
          [
            gateway.address,
            user.address,
            stablecoin.address,
            paymentAmount,
            meshId,
            nonce,
            timestamp,
          ]
        )
      );
      const signedMessage = await verifier.signMessage(ethers.utils.arrayify(messageHash));

      await expect(
        gateway.processPayment(
          user.address,
          stablecoin.address,
          paymentAmount,
          meshId,
          nonce,
          timestamp,
          signedMessage
        )
      ).to.be.revertedWith("Mesh amount too small");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      await gateway.pause();
      expect(await gateway.paused()).to.be.true;
    });

    it("Should prevent payment when paused", async function () {
      await gateway.pause();

      const paymentAmount = ethers.utils.parseEther("100");
      const meshId = "";
      const nonce = 5;
      const timestamp = Math.floor(Date.now() / 1000);

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint256", "string", "uint256", "uint256"],
          [
            gateway.address,
            user.address,
            stablecoin.address,
            paymentAmount,
            meshId,
            nonce,
            timestamp,
          ]
        )
      );
      const signedMessage = await verifier.signMessage(ethers.utils.arrayify(messageHash));

      await expect(
        gateway.processPayment(
          user.address,
          stablecoin.address,
          paymentAmount,
          meshId,
          nonce,
          timestamp,
          signedMessage
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });
});

