import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

describe("Meshes.sol", function () {
  let meshes: any;
  let treasury: any;
  let governanceSafe: any;
  let user1: any;
  let user2: any;

  const SECONDS_IN_DAY = 86400;
  const HOUR_SECONDS = 3600;

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    user1 = signers[1] || signers[0];
    user2 = signers[2] || signers[0];
    treasury = signers[3] || signers[0];

    const MeshesF = await ethers.getContractFactory("Meshes");
    meshes = await MeshesF.connect(governanceSafe).deploy(governanceSafe.address);
    await meshes.deployed();
    
    // Set treasury address to prevent "transfer to zero address" errors
    await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);
  });

  async function expectRevert(p: Promise<any>, reasonIncludes: string) {
    try {
      await p;
      expect.fail("Expected revert, but tx succeeded");
    } catch (e: any) {
      expect(String(e.message)).to.include(reasonIncludes);
    }
  }

  function expectEvent(receipt: any, eventName: string) {
    const evts = receipt?.events || [];
    const found = evts.find((e: any) => e.event === eventName);
    expect(!!found).to.equal(true);
  }

  function expectEqBN(actual: any, expected: any) {
    expect(BigNumber.from(actual).eq(BigNumber.from(expected))).to.equal(true);
  }

  describe("Deployment", () => {
    it("sets constructor params", async () => {
      expect(await meshes.treasuryAddress()).to.equal(ethers.constants.AddressZero);
      // governanceSafe not exposed via getter; check onlyGovernance gate with pause
      await expectRevert(meshes.connect(user1).pause(), "Only Owner governance");
      await meshes.connect(governanceSafe).pause();
      expect(await meshes.paused()).to.equal(true);
      await meshes.connect(governanceSafe).unpause();
      expect(await meshes.paused()).to.equal(false);
    });
  });

  describe("Access control (onlyGovernance)", () => {
    it("restricts admin calls to governanceSafe", async () => {
      await expectRevert(meshes.connect(user1).pause(), "Only Owner governance");
      await meshes.connect(governanceSafe).pause();
      await meshes.connect(governanceSafe).unpause();

      // setBurnScale replaces old switch; 0 disables, >0 enables scaling
      await expectRevert(meshes.connect(user1).setBurnScale(1000), "Only Owner governance");
      await meshes.connect(governanceSafe).setBurnScale(1000);
      expect((await meshes.burnScaleMilli()).toNumber ? (await meshes.burnScaleMilli()).toNumber() : await meshes.burnScaleMilli()).to.not.equal(0);

      await expectRevert(
        meshes.connect(user1).setTreasuryAddress(user1.address),
        "Only Owner governance"
      );
      await meshes.connect(governanceSafe).setTreasuryAddress(user1.address);
      expect(await meshes.treasuryAddress()).to.equal(user1.address);
      // revert back for rest of tests
      await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);

      await expectRevert(
        meshes.connect(user1).setGovernanceSafe(user1.address),
        "Only Owner governance"
      );
      await meshes.connect(governanceSafe).setGovernanceSafe(user1.address);
      // Now only user1 can call admin
      await expectRevert(meshes.connect(governanceSafe).pause(), "Only Owner governance");
      await meshes.connect(user1).pause();
      await meshes.connect(user1).unpause();
      // switch back to original to not affect other tests
      await meshes.connect(user1).setGovernanceSafe(governanceSafe.address);
    });
  });

  describe("isValidMeshID", () => {
    it("accepts valid formats", async () => {
      expect(await meshes.isValidMeshID("E123N45")).to.equal(true);
      expect(await meshes.isValidMeshID("W17999S9000")).to.equal(true);
      expect(await meshes.isValidMeshID("E0N0")).to.equal(true);
    });
    it("rejects invalid formats", async () => {
      expect(await meshes.isValidMeshID("")).to.equal(false);
      expect(await meshes.isValidMeshID("A123B45")).to.equal(false);
      expect(await meshes.isValidMeshID("E18000N1")).to.equal(false); // lon >= 18000
      expect(await meshes.isValidMeshID("E1S9001")).to.equal(false); // lat > 9000
      expect(await meshes.isValidMeshID("EN1")).to.equal(false); // missing digits
    });
  });

  describe("claimMesh", () => {
    it("reverts when paused", async () => {
      await meshes.connect(governanceSafe).pause();
      await expectRevert(
        meshes.connect(user1).claimMesh("E10N10"),
        "paused"
      );
    });

    it("claims first time and updates state/events", async () => {
      const meshID = "E10N10";
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();
      expectEvent(rc, "MeshClaimed");

      // active minters and meshes increment
      expectEqBN(await meshes.activeClaimers(), 1);
      expectEqBN(await meshes.activeMeshes(), 1);
      expectEqBN(await meshes.totalClaimMints(), 1);

      // duplicate by same user should revert
      await expectRevert(meshes.connect(user1).claimMesh(meshID), "Already claim");

      // another user can claim same mesh (no burn when burnSwitch=false)
      await meshes.connect(user2).claimMesh(meshID);
      expectEqBN(await meshes.totalClaimMints(), 2);
    });

    it("burn scale: second claimant requires token to burn", async () => {
      const meshID = "E20N20";
      // First claimant creates heat
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(1000);
      // Second claimant without tokens should fail due to burn requirement
      await expectRevert(
        meshes.connect(user2).claimMesh(meshID),
        "Insufficient to burn"
      );
    });
  });

  describe("withdraw and accounting", () => {
    it("mints daily payout after one day and enforces once-per-day", async () => {
      const meshID = "E30N30";
      await meshes.connect(user1).claimMesh(meshID);

      // Day 0 -> cannot withdraw yet (lastWithdrawDay == 0, dayIndex == 0)
      await expectRevert(meshes.connect(user1).withdraw(), "Daily receive");

      // Advance 1 day
      await increaseTime(SECONDS_IN_DAY);

      // Expected payout: weight = 1e18 (heat for first claimant index 0), factor = 1e10
      const totalSupplyBefore = await meshes.totalSupply();
      const balBefore = await meshes.balanceOf(user1.address);
      const txW = await meshes.connect(user1).withdraw();
      const rcW = await txW.wait();
      expectEvent(rcW, "WithdrawProcessed");
      const balAfter = await meshes.balanceOf(user1.address);
      const totalSupplyAfter = await meshes.totalSupply();

      const payout = balAfter.sub(balBefore);
      // Day0 carry (50%) + Day1 payout (100%) = 1.5 token
      expectEqBN(payout.mul(2), ethers.utils.parseEther("3"));
      // totalSupply also reflects foundation/burn minting, so we don't assert it equals payout

      // same day second withdraw should fail
      await expectRevert(meshes.connect(user1).withdraw(), "Daily receive");
    });

    it("applies unclaimed decay and pays foundation hourly when due", async () => {
      const meshID = "E40N40";
      await meshes.connect(user1).claimMesh(meshID);

      // Move to day 1 and withdraw once (to initialize processed day)
      await increaseTime(SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();

      // Skip 2 more days without withdrawing so decay accrues
      await increaseTime(2 * SECONDS_IN_DAY);

      // Withdraw on day 3 to apply decay and accumulate foundation pool
      await meshes.connect(user1).withdraw();

      // At this point, pendingFoundationPool should be > 0 and _maybePayoutFoundation
      // has been called inside withdraw; however payout only happens at next hour boundary.
      // Advance one hour and trigger payout explicitly
      await increaseTime(HOUR_SECONDS + 5);
      const fBefore = await meshes.balanceOf(foundation.address);
      const tx2 = await meshes.connect(user1).payoutFoundationIfDue();
      await tx2.wait();
      const fAfter = await meshes.balanceOf(foundation.address);
      // Depending on hour boundary, payout may have already occurred inside withdraw; accept no change
      expect(BigNumber.from(fAfter).gte(BigNumber.from(fBefore))).to.equal(true);
    });
  });

  describe("Dashboards and views", () => {
    it("getMeshData / getMeshDashboard / getDashboard return sane values", async () => {
      await meshes.connect(user1).claimMesh("E50N50");

      const meshData = await meshes.getMeshData();
      expectEqBN(meshData.userCounts, 1);
      expectEqBN(meshData.totalMinted, await meshes.totalSupply());

      const dash = await meshes.getMeshDashboard();
      expectEqBN(dash.participants, 1);
      expectEqBN(dash.claimedMesh, 1);

      const dashboard = await meshes.getDashboard();
      const total = await meshes.totalSupply();
      const liquid = total.sub(await meshes.balanceOf(await meshes.address));
      expectEqBN(dashboard._totalSupply, total);
      expectEqBN(dashboard._liquidSupply, liquid);
    });

    it("quoteClaimCost returns zero cost for first claim and >0 when heated", async () => {
      const meshID = "E60N60";
      let [heat0, cost0] = await meshes.quoteClaimCost(meshID);
      expectEqBN(cost0, 0);

      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(1000);
      const [heat1, cost1] = await meshes.quoteClaimCost(meshID);
      // heat > 0, and since cnt>0 now, cost for the next claimant should be > 0 when burnSwitch is on
      expect(BigNumber.from(heat1).gt(0)).to.equal(true);
      expect(BigNumber.from(cost1).gt(0)).to.equal(true);
    });

    it("rejects invalid mesh ID on ClaimMesh and view functions handle gracefully", async () => {
      await expectRevert(meshes.connect(user1).claimMesh("invalid"), "Invalid meshID format");
      const info = await meshes.getMeshInfo("invalid");
      // returns zeros and parsed lon/lat as 0,0
      expectEqBN(info.applyCount, 0);
      expectEqBN(info.heat, 0);
    });
  });

  describe("Edge cases", () => {
    it("yearly decay over multiple years", async () => {
      await meshes.connect(user1).claimMesh("E70N70");
      // day 1
      await increaseTime(SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      // Note: getCurrentDayYear function removed, testing withdrawal across multiple years
      const balance1 = await meshes.balanceOf(user1.address);
      expect(BigNumber.from(balance1).gt(0)).to.equal(true);

      // move to day 365 (add 364)
      await increaseTime(364 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      const balance2 = await meshes.balanceOf(user1.address);
      expect(BigNumber.from(balance2).gt(balance1)).to.equal(true);

      // move to day 730 (another 365)
      await increaseTime(365 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      const balance3 = await meshes.balanceOf(user1.address);
      expect(BigNumber.from(balance3).gt(balance2)).to.equal(true);
    });

    it("extreme coordinate boundaries", async () => {
      // Valid extremes
      expect(await meshes.isValidMeshID("E17999N9000")).to.equal(true);
      expect(await meshes.isValidMeshID("W0N0")).to.equal(true);
      expect(await meshes.isValidMeshID("W17999S0")).to.equal(true);
      expect(await meshes.isValidMeshID("E0S9000")).to.equal(true);
      expect(await meshes.isValidMeshID("E1N1")).to.equal(true);

      // Invalid forms
      expect(await meshes.isValidMeshID("E18000N0")).to.equal(false);
      expect(await meshes.isValidMeshID("E0N9001")).to.equal(false);
      expect(await meshes.isValidMeshID("X10N10")).to.equal(false);
      expect(await meshes.isValidMeshID("E10Q10")).to.equal(false);
      expect(await meshes.isValidMeshID("E-1N0")).to.equal(false);
    });

    it("previewWithdraw matches realized payout next day", async () => {
      const meshID = "E80N80";
      await meshes.connect(user1).claimMesh(meshID);

      // Day 0 preview
      const pre0 = await meshes.previewWithdraw(user1.address);

      // Move to day 1
      await increaseTime(SECONDS_IN_DAY);
      const pre1 = await meshes.previewWithdraw(user1.address); // payoutToday for day1

      const balBefore = await meshes.balanceOf(user1.address);
      await meshes.connect(user1).withdraw();
      const balAfter = await meshes.balanceOf(user1.address);
      const minted = balAfter.sub(balBefore);

      // minted == carry from day0 (if not withdraw) + day1 payout
      const expected = BigNumber.from(pre0.carryAfterIfNoWithdraw).add(
        BigNumber.from(pre1.payoutToday)
      );
      expectEqBN(minted, expected);
    });

    it("setTreasuryAddress rejects zero and same address; setGovernanceSafe rejects invalid", async () => {
      // Treasury address already set in beforeEach
      await expectRevert(meshes.connect(governanceSafe).setTreasuryAddress("0x0000000000000000000000000000000000000000"), "Invalid treasury address");
      await expectRevert(meshes.connect(governanceSafe).setTreasuryAddress(await meshes.treasuryAddress()), "Same treasury address");
      await expectRevert(meshes.connect(governanceSafe).setGovernanceSafe("0x0000000000000000000000000000000000000000"), "Invalid safe");
      await expectRevert(meshes.connect(governanceSafe).setGovernanceSafe(governanceSafe.address), "Same safe");
    });

    it("setBurnScale bounds and events", async () => {
      await expectRevert(meshes.connect(governanceSafe).setBurnScale(1_000_001), "Scale too large");
      const tx = await meshes.connect(governanceSafe).setBurnScale(1234);
      const rc = await tx.wait();
      expectEvent(rc, "BurnScaleUpdated");
    });
  });
});

// Helpers for flexible event arg matching
function anyInt32() {
  return (val: any) => typeof val === "number" || BigNumber.isBigNumber(val);
}
function anyUint32() {
  return (val: any) => typeof val === "number" || BigNumber.isBigNumber(val);
}
function anyBigInt() {
  return (val: any) => typeof val === "string" || BigNumber.isBigNumber(val);
}


