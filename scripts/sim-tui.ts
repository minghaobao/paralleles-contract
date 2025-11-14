const path = require("path");
const fs = require("fs");
process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "localhost";
process.env.HARDHAT_CONFIG = path.resolve(__dirname, "../hardhat.test.config.ts");

const SECONDS_IN_DAY = 86400;

function randInt(max: number) { return Math.floor(Math.random() * max); }
function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }

async function main() {
  const hre = require("hardhat");
  const { ethers, network } = hre;
  const { BigNumber } = ethers;

  function fmt(n: any) {
    return BigNumber.isBigNumber(n) ? ethers.utils.formatEther(n) : String(n);
  }

  const signers = await ethers.getSigners();
  const [governanceSafe, foundation, ...rest] = signers;
  const users = rest.slice(0, 16);

  const addrFile = path.resolve(__dirname, "../logs/deployed-addresses.json");
  let meshes: any;
  const hasAddrs = fs.existsSync(addrFile);
  if (hasAddrs) {
    const raw = JSON.parse(fs.readFileSync(addrFile, "utf8"));
    const m = raw.meshes;
    const Meshes = await ethers.getContractFactory("Meshes");
    meshes = Meshes.attach(m);
    // 验证地址在当前链上是否有代码；若无则重新部署
    const codeM = await ethers.provider.getCode(m);
    if (codeM === "0x") {
      console.log("Address file found but no code on chain, re-deploying...");
      meshes = undefined as any;
    }
    if (meshes) {
      try {
        const safeM = await meshes.governanceSafeAddress();
        if (safeM.toLowerCase() !== (await (await ethers.getSigners())[0].getAddress()).toLowerCase()) {
          console.log("Governance safe mismatch with current signer; re-deploying for a clean session...");
          meshes = undefined as any;
        }
      } catch {}
    }
  }
  if (!meshes) {
    const Meshes = await ethers.getContractFactory("Meshes");
    meshes = await Meshes.deploy(foundation.address, governanceSafe.address);
    await meshes.deployed();
    const addrs = { meshes: meshes.address };
    const dir = path.dirname(addrFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(addrFile, JSON.stringify(addrs, null, 2));
  }

  // 初始化：设置燃烧缩放系数（例如 1000 = 1.0x 或 500 = 0.5x）
  try {
    await (await meshes.connect(governanceSafe).setBurnScale(72000)).wait(); // 72.0x 更接近一个月收益
  } catch {}

  const opLog: string[] = [];
  const logDir = path.resolve(__dirname, "../logs");
  const logFile = path.resolve(logDir, `sim-ops.log`);
  const claimedFile = path.resolve(logDir, `claimed-meshes.json`);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  function pushLog(s: string) {
    opLog.push(s);
    if (opLog.length > 200) opLog.shift();
    const line = `[${new Date().toISOString()}] ${s}`;
    try { fs.appendFileSync(logFile, line + "\n"); } catch {}
  }

  // 全局已被认领的网格（持久化，供单用户读取）
  let claimedGlobal = new Set<string>();
  try {
    if (fs.existsSync(claimedFile)) {
      const arr = JSON.parse(fs.readFileSync(claimedFile, "utf8"));
      if (Array.isArray(arr)) for (const x of arr) claimedGlobal.add(String(x));
    }
  } catch {}

  function genMesh() {
    const ew = Math.random() < 0.5 ? "E" : "W";
    const ns = Math.random() < 0.5 ? "N" : "S";
    const lon = randInt(1000);
    const lat = randInt(9000);
    return `${ew}${lon}${ns}${lat}`;
  }

  async function increaseTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
  }

  async function draw() {
    process.stdout.write("\x1b[2J\x1b[0f"); // clear screen
    const md = await meshes.getMeshData();
    const dash = await meshes.getMeshDashboard();
    const earth = await meshes.getEarthDashboard();

    console.log("===== 仪表盘 (Dashboard) =====");
    console.log(`participants: ${md.userCounts}`);
    console.log(`claimMints:   ${dash.totalclaimMints}`);
    console.log(`activeMeshes: ${dash.claimedMesh}`);
    console.log(`maxHeats:     ${dash.maxHeats}`);
    console.log(`totalSupply:  ${earth._totalSupply}`);
    console.log(`liquidSupply: ${earth._liquidSupply}`);
    console.log(`foundationBal:${await meshes.balanceOf(foundation.address)}`);
    console.log("");

    console.log("===== 操作日志 (Operations) =====  (按 q 退出)");
    const last = opLog.slice(-12);
    for (const l of last) console.log(l);
    for (let i = last.length; i < 12; i++) console.log("");

    console.log("===== 用户钱包状态 (前8名) =====");
    const show = users.slice(0, 8);
    for (let i = 0; i < show.length; i++) {
      const u = show[i];
      const meshBal = await meshes.balanceOf(u.address);
      console.log(`${i.toString().padStart(2, "0")} ${shortAddr(u.address)} | MESH=${fmt(meshBal)}`);
    }
  }

  let quit = false;
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", (b) => {
    const c = b.toString();
    if (c === "q" || c === "Q") {
      quit = true;
    }
  });

  pushLog(`Start TUI: users=${users.length}`);
  const existingMeshes: string[] = [];
  const hotspots: string[] = [
    "E100N100",
    "E777N2745",
    "W970N8459",
    "E573N1161",
    "W483N7462",
    "E783N8955",
    "W604S2293",
    "E810S1515",
    "E627S1563",
    "W179N7683"
  ];
  const FOCUS_ID = hotspots[0];
  let bootstrapClaims = 500; // 前 500 次claim集中于同一热点以拉高 maxHeats & burn

  // 每用户已认领集合（减少 "Already claim" 的无谓回退）
  const claimedByUser: Record<string, Set<string>> = {};

  // main loop
  while (!quit) {
    const action = randInt(2); // 0=claim,1=withdraw
    const u = users[randInt(users.length)];

    try {
      if (action === 0) {
        const key = u.address.toLowerCase();
        claimedByUser[key] = claimedByUser[key] || new Set<string>();
        const owned = claimedByUser[key];
        let id = "";

        // 简化逻辑：直接50/50分配，不区分bootstrap阶段
        const pickOthers = Math.random() < 0.5;
        
        if (pickOthers && claimedGlobal.size > 0) {
          // 50%：选择他人已认领的网格（可能包括自己已拥有的，让合约处理重复）
          const globalArray = Array.from(claimedGlobal);
          id = globalArray[randInt(globalArray.length)];
        } else {
          // 50%：选择新的随机网格
          id = genMesh();
        }

        // 执行claim，让合约处理所有验证逻辑
        try {
          await (await meshes.connect(u).claimMesh(id, { gasLimit: 900000 })).wait();
          claimedByUser[key].add(id);
          claimedGlobal.add(id);
          try { fs.writeFileSync(claimedFile, JSON.stringify(Array.from(claimedGlobal))); } catch {}
          pushLog(`claim ${shortAddr(u.address)} id=${id}`);
          existingMeshes.push(id);
        } catch (e: any) {
          const errMsg = String(e.message);
          if (errMsg.includes('Already claim')) {
            // 如果是重复claim错误，更新本地状态
            claimedByUser[key].add(id);
            pushLog(`claim skipped ${shortAddr(u.address)} id=${id} (already claimed)`);
          } else {
            pushLog(`claim failed ${shortAddr(u.address)} id=${id}: ${errMsg.slice(0, 50)}`);
          }
        }
      } else if (action === 1) {
        // 预检查：仅当 dayIndex > lastProcessedDay 且 weight>0 才尝试提现
        const cur = await meshes.getCurrentDayYear();
        const us = await meshes.getUserState(u.address);
        const weight = us[0];
        const lastProc = us[3];
        if (weight.gt(0) && cur.dayIndex.gt(lastProc)) {
          await (await meshes.connect(u).withdraw({ gasLimit: 450000 })).wait();
          pushLog(`withdraw ${shortAddr(u.address)}`);
        } else {
          pushLog(`withdraw skipped ${shortAddr(u.address)} (not eligible)`);
        }
      }
    } catch (e: any) {
      pushLog(`error: ${String(e.message).slice(0, 80)}`);
    }

    // 时间推进，促进日结算与衰减逻辑
    if (Math.random() < 0.35) await increaseTime(SECONDS_IN_DAY / 2);

    await draw();
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("退出测试 (Quit)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



