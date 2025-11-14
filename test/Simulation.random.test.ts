import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

// Simple console printer for state snapshots
async function printState(tag: string, meshes: any, reward: any, foundation: any, users: any[]) {
  const md = await meshes.getMeshData();
  const dash = await meshes.getMeshDashboard();
  const earth = await meshes.getEarthDashboard();

  const line = (k: string, v: any) => console.log(`${tag} | ${k}: ${v.toString ? v.toString() : v}`);
  line("participants", md.userCounts);
  line("claimMints", dash.totalclaimMints);
  line("activeMeshes", dash.claimedMesh);
  line("maxHeats", dash.maxHeats);
  line("totalSupply", earth._totalSupply);
  line("liquidSupply", earth._liquidSupply);
  line("foundationBal", await meshes.balanceOf(foundation.address));

  for (let i = 0; i < Math.min(users.length, 5); i++) {
    const u = users[i];
    const st = await meshes.getUserState(u.address);
    console.log(`${tag} | user[${i}] weight=${st.weight.toString()} claims=${st.claimCount}`);
  }
}

function randInt(max: number) { return Math.floor(Math.random() * max); }

describe("Random simulation: Meshes + Reward", function () {
  const SECONDS_IN_DAY = 86400;
  const USERS = 12; // n users
  let governanceSafe: any;
  let foundation: any;
  let users: any[] = [];
  let token: any;
  let meshes: any;
  let reward: any;
  let verifier: any;

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    [governanceSafe, foundation, ...users] = signers;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Mock", "MOCK");
    await token.deployed();

    const Meshes = await ethers.getContractFactory("Meshes");
    meshes = await Meshes.deploy(foundation.address, governanceSafe.address);
    await meshes.deployed();

    const Reward = await ethers.getContractFactory("Reward");
    reward = await Reward.deploy(token.address, foundation.address, governanceSafe.address);
    await reward.deployed();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    verifier = await MockVerifier.deploy(true);
    await verifier.deployed();
    await reward.connect(governanceSafe).setCheckInVerifier(verifier.address);

    // prepare foundation token allowance for Reward
    await token.mint(foundation.address, ethers.utils.parseEther("10000000"));
    await token.connect(foundation).approve(reward.address, ethers.utils.parseEther("10000000"));
  });

  it("runs random actions and prints state", async () => {
    // random mesh ids generator
    const genMesh = () => {
      const ew = Math.random() < 0.5 ? "E" : "W";
      const ns = Math.random() < 0.5 ? "N" : "S";
      const lon = randInt(1000); // keep within bounds
      const lat = randInt(9000);
      return `${ew}${lon}${ns}${lat}`;
    };

    // scenario params
    const rounds = 20;
    console.log(`Start random simulation: users=${USERS}, rounds=${rounds}`);

    await printState("INIT", meshes, reward, foundation, users);

    for (let r = 0; r < rounds; r++) {
      const action = randInt(3); // 0=claim,1=withdraw,2=reward
      const u = users[randInt(USERS)];

      if (action === 0) {
        const id = genMesh();
        try {
          await (await meshes.connect(u).claimMesh(id)).wait();
          console.log(`R${r} claim by ${u.address} id=${id}`);
        } catch (e: any) {
          console.log(`R${r} claim failed(${u.address}): ${id} -> ${String(e.message).slice(0,60)}`);
        }
      } else if (action === 1) {
        try {
          await (await meshes.connect(u).withdraw()).wait();
          console.log(`R${r} withdraw by ${u.address}`);
        } catch (e: any) {
          console.log(`R${r} withdraw failed(${u.address}): ${String(e.message).slice(0,60)}`);
        }
      } else {
        const amt = ethers.utils.parseEther(String(1 + randInt(5))); // 1..5
        try {
          await (await reward.connect(governanceSafe).setUserReward([u.address], [amt], amt)).wait();
          // some users withdraw immediately
          if (Math.random() < 0.5) {
            const info = await reward.getRewardAmount(u.address);
            const avail: BigNumber = info.availableAmount;
            const take = avail.div(2);
            if (take.gt(0)) {
              await (await reward.connect(u).withdraw(take)).wait();
            }
          }
          console.log(`R${r} reward ${ethers.utils.formatEther(amt)} to ${u.address}`);
        } catch (e: any) {
          console.log(`R${r} reward failed: ${String(e.message).slice(0,60)}`);
        }
      }

      // occasionally advance time ~ half day to change daily logic
      if (Math.random() < 0.4) {
        await increaseTime(SECONDS_IN_DAY / 2);
      }

      if (r % 5 === 0) {
        await printState(`R${r}`, meshes, reward, foundation, users);
      }
    }

    await printState("END", meshes, reward, foundation, users);
    expect(true).to.equal(true);
  });
});


