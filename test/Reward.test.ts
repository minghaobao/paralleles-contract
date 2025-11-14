import { expect } from "chai";
import { ethers } from "hardhat";

describe("Reward.sol", function () {
  let token: any;
  let reward: any;
  let foundation: any;
  let governanceSafe: any;
  let user1: any;
  let user2: any;
  let verifier: any;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    foundation = signers[1] || signers[0];
    user1 = signers[2] || signers[0];
    user2 = signers[3] || signers[0];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Mock", "MOCK");
    await token.deployed();

    const Reward = await ethers.getContractFactory("Reward");
    reward = await Reward.deploy(token.address, foundation.address, governanceSafe.address);
    await reward.deployed();

    // Foundation prepares allowance for Reward withdrawals
    await token.mint(foundation.address, ethers.utils.parseEther("1000000"));
    await token.connect(foundation).approve(reward.address, ethers.utils.parseEther("1000000"));

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    verifier = await MockVerifier.deploy(true);
    await verifier.deployed();
    await reward.connect(governanceSafe).setCheckInVerifier(verifier.address);
  });

  it("onlySafe can set rewards; users can withdraw and withdrawAll", async () => {
    // manually check revert without .revertedWith matcher
    try {
      await reward.connect(user1).setUserReward([user1.address], [ethers.utils.parseEther("100")], ethers.utils.parseEther("100"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("Only Safe");
    }

    // 先给 Reward 合约充值，确保有足够余额
    await token.mint(reward.address, ethers.utils.parseEther("200"));

    await reward
      .connect(governanceSafe)
      .setUserReward([user1.address, user2.address], [ethers.utils.parseEther("100"), ethers.utils.parseEther("50")], ethers.utils.parseEther("150"));

    let info = await reward.getRewardAmount(user1.address);
    expect(info.totalAmount.eq(ethers.utils.parseEther("100"))).to.equal(true);

    await reward.connect(user1).withdraw(ethers.utils.parseEther("40"));
    const b40 = await token.balanceOf(user1.address);
    expect(b40.eq(ethers.utils.parseEther("40"))).to.equal(true);

    await reward.connect(user1).withdrawAll();
    const bal = await token.balanceOf(user1.address);
    expect(bal.eq(ethers.utils.parseEther("100"))).to.equal(true);
  });

  it("activity reward updates userRewards when verifier allows", async () => {
    await reward.connect(governanceSafe).setUserReward([user1.address], [ethers.utils.parseEther("1")], ethers.utils.parseEther("1"));
    await reward.connect(governanceSafe).rewardActivityWinner(1, user1.address, ethers.utils.parseEther("2"));
    const info = await reward.getRewardAmount(user1.address);
    expect(info.totalAmount.eq(ethers.utils.parseEther("3"))).to.equal(true);

    // batch path
    await reward.connect(governanceSafe).rewardActivityWinnersBatch(2, [user2.address], [ethers.utils.parseEther("5")]);
    const info2 = await reward.getRewardAmount(user2.address);
    expect(info2.totalAmount.eq(ethers.utils.parseEther("5"))).to.equal(true);
  });

  it("verifier blocks rewards and param validation errors", async () => {
    // set verifier to false
    await verifier.set(false);
    try {
      await reward.connect(governanceSafe).rewardActivityWinner(1, user1.address, ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("Not eligible");
    }

    // invalid arrays
    try {
      await reward.connect(governanceSafe).setUserReward([user1.address], [ethers.utils.parseEther("1"), ethers.utils.parseEther("2")], ethers.utils.parseEther("3"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("Array length mismatch");
    }

    // empty arrays
    try {
      // @ts-ignore
      await reward.connect(governanceSafe).setUserReward([], [], 0);
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("Empty arrays");
    }

    // invalid user
    try {
      await reward.connect(governanceSafe).setUserReward([ethers.constants.AddressZero], [ethers.utils.parseEther("1")], ethers.utils.parseEther("1"));
      expect.fail("should revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("Invalid user address");
    }
  });
});


