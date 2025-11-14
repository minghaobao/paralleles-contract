const path = require("path");
process.env.HARDHAT_CONFIG = path.resolve(__dirname, "../hardhat.test.config.ts");
process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "localhost";
const fs = require("fs");

async function main() {
  const hre = require("hardhat");
  const { ethers, network } = hre;
  const { BigNumber } = ethers;

  const SECONDS_IN_DAY = 86400;
  function fmt(n: any) { return BigNumber.isBigNumber(n) ? ethers.utils.formatEther(n) : String(n); }
  function fmtGas(n: any) { return BigNumber.isBigNumber(n) ? n.toString() : String(n); }
  function short(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
  function randInt(max: number) { return Math.floor(Math.random() * max); }

  const [governanceSafe, foundation, user] = await ethers.getSigners();

  const addrFile = path.resolve(__dirname, "../logs/deployed-addresses.json");
  if (!fs.existsSync(addrFile)) {
    console.error("deployed-addresses.json not found. Please start sim-tui.ts first to deploy and record addresses.");
    process.exit(1);
  }
  const { meshes: m } = JSON.parse(fs.readFileSync(addrFile, "utf8"));
  const Meshes = await ethers.getContractFactory("Meshes");
  const meshes = Meshes.attach(m);
  // 确认当前链上该地址存在合约代码（避免因新节点/地址失效导致的 CALL_EXCEPTION）
  const codeAt = await ethers.provider.getCode(m);
  if (codeAt === "0x") {
    console.error(
      "No contract code at address from logs/deployed-addresses.json on this network.\n" +
      "Please start a hardhat node and run sim-tui.ts first to deploy, or ensure the address file matches the current chain."
    );
    process.exit(1);
  }

  const opLog: string[] = [];
  const logDir = path.resolve(__dirname, "../logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.resolve(logDir, `sim-user-${Date.now()}.log`);
  const claimedFile = path.resolve(logDir, `claimed-meshes.json`);
  
  function pushLog(s: string) {
    const line = `[${new Date().toISOString()}] ${s}`;
    opLog.push(line);
    if (opLog.length > 50) opLog.shift();
    try { fs.appendFileSync(logFile, line + "\n"); } catch {}
  }

  // 从多用户模拟共享的"全局已认领集合"读取
  let claimedGlobal = new Set<string>();
  try {
    if (fs.existsSync(claimedFile)) {
      const arr = JSON.parse(fs.readFileSync(claimedFile, "utf8"));
      if (Array.isArray(arr)) for (const x of arr) claimedGlobal.add(String(x));
    }
  } catch {}

  const myMeshes: string[] = [];

  // 统计数据
  let totalClaimOps = 0;
  let successfulClaims = 0;
  let totalWithdrawOps = 0;
  let successfulWithdraws = 0;
  let totalGasUsed = BigNumber.from(0);
  let totalClaimBurn = BigNumber.from(0);
  let totalDecayBurn = BigNumber.from(0);
  let totalIncome = BigNumber.from(0);
  let totalBurnCost = BigNumber.from(0);
  let fromExistingClaims = 0; // 从已存在网格的认领数
  let fromNewClaims = 0; // 新网格认领数

  function genMesh() {
    const ew = Math.random() < 0.5 ? "E" : "W";
    const ns = Math.random() < 0.5 ? "N" : "S";
    const lon = randInt(1000);
    const lat = randInt(9000);
    return `${ew}${lon}${ns}${lat}`;
  }

  async function drawSummary() {
    try {
      process.stdout.write("\x1b[2J\x1b[0f"); // clear screen
    } catch (e) {
      // Handle EPIPE error gracefully
      return;
    }
    let md: any = { userCounts: "-" };
    let dash: any = { totalclaimMints: "-", claimedMesh: "-", maxHeats: "-" };
    let earth: any = { _totalSupply: "-", _liquidSupply: "-", _destruction: "-" };
    let meshBal: any = "-";
    let foundationBal: any = "-";
    try {
      md = await meshes.getMeshData();
      dash = await meshes.getMeshDashboard();
      earth = await meshes.getEarthDashboard();
      meshBal = await meshes.balanceOf(user.address);
      foundationBal = await meshes.balanceOf(foundation.address);
    } catch {}
    
    console.log("===== 📊 统计面板 (Statistics Dashboard) =====");
    console.log(`🌐 网络状态: 参与者=${md.userCounts} | 总认领=${dash.totalclaimMints} | 活跃网格=${dash.claimedMesh} | 最大热度=${fmt(dash.maxHeats)}`);
    console.log(`💰 代币状态: 总供应=${fmt(earth._totalSupply)} | 流通=${fmt(earth._liquidSupply)} | 总销毁=${fmt(earth._destruction)}`);
    console.log(`👤 用户状态: 我的MESH=${fmt(meshBal)} | 拥有网格=${myMeshes.length} | 基金会=${fmt(foundationBal)}`);
    console.log("");
    
    console.log("===== 📈 操作统计 (Operation Stats) =====");
    const claimSuccessRate = totalClaimOps > 0 ? (successfulClaims / totalClaimOps * 100).toFixed(1) : "0";
    const withdrawSuccessRate = totalWithdrawOps > 0 ? (successfulWithdraws / totalWithdrawOps * 100).toFixed(1) : "0";
    const avgGasPerOp = (totalClaimOps + totalWithdrawOps) > 0 ? 
      totalGasUsed.div(totalClaimOps + totalWithdrawOps).toString() : "0";
    const existingRate = totalClaimOps > 0 ? (fromExistingClaims / totalClaimOps * 100).toFixed(1) : "0";
    
    console.log(`🔥 Claim操作: ${successfulClaims}/${totalClaimOps} (${claimSuccessRate}%) | 已存在网格: ${fromExistingClaims} (${existingRate}%) | 新网格: ${fromNewClaims}`);
    console.log(`💸 Withdraw操作: ${successfulWithdraws}/${totalWithdrawOps} (${withdrawSuccessRate}%) | 平均Gas: ${avgGasPerOp}`);
    console.log(`⛽ 总Gas消耗: ${fmtGas(totalGasUsed)} wei | 总收入: ${fmt(totalIncome)} MESH`);
    console.log(`🔥 燃烧统计: Claim燃烧=${fmt(totalClaimBurn)} | 衰减燃烧=${fmt(totalDecayBurn)} | 总燃烧成本=${fmt(totalBurnCost)}`);
    console.log("");
    
    console.log("===== 📝 操作日志 (Operation Logs) ===== (按 q 退出)");
    
    // 显示最近的操作日志
    const recentLogs = opLog.slice(-15);
    for (const log of recentLogs) {
      console.log(log);
    }
  }

  let quit = false;
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", (b: Buffer) => {
    const c = b.toString();
    if (c === "q" || c === "Q") quit = true;
  });

  pushLog(`Start single-user TUI: user=${user.address}`);

  while (!quit) {
    const a = Math.random();
    try {
      if (a < 0.5) {
        // Claim：采用与sim-tui相同的50/50策略
        totalClaimOps++;
        const owned = new Set(myMeshes);
        let id = "";

        // 严格50/50分配：50%选择全局已认领，50%选择新网格
        const pickOthers = Math.random() < 0.5;
        
        if (pickOthers && claimedGlobal.size > 0) {
          // 50%：从全局已认领网格中随机选择
          const globalArray = Array.from(claimedGlobal);
          id = globalArray[randInt(globalArray.length)];
          fromExistingClaims++;
        } else {
          // 50%：选择新的随机网格
          id = genMesh();
          fromNewClaims++;
        }

        const beforeUserBal = await meshes.balanceOf(user.address);
        const beforeEarth = await meshes.getEarthDashboard();
        let beforeInfo: any;
        let quoteCost = BigNumber.from(0);
        
        try {
          beforeInfo = await meshes.getMeshInfo(id);
          const q = await meshes.quoteClaimCost(id);
          quoteCost = q[1];
        } catch {
          beforeInfo = { applyCount: 0, heat: BigNumber.from(0) };
        }

        let gasUsed = BigNumber.from(0);
        let claimType = pickOthers ? "🔄二次认领" : "🆕新网格";
        
        try {
          const tx = await meshes.connect(user).claimMesh(id, { gasLimit: 900000 });
          const rc = await tx.wait();
          gasUsed = rc.gasUsed;
          totalGasUsed = totalGasUsed.add(gasUsed);
          successfulClaims++;
          
          if (!myMeshes.includes(id)) {
            myMeshes.push(id);
          }
          
          // 写回全局集合
          try {
            claimedGlobal.add(id);
            fs.writeFileSync(claimedFile, JSON.stringify(Array.from(claimedGlobal)));
          } catch {}
          
          const afterUserBal = await meshes.balanceOf(user.address);
          const afterEarth = await meshes.getEarthDashboard();
          let afterInfo: any;
          try {
            afterInfo = await meshes.getMeshInfo(id);
          } catch {
            afterInfo = { applyCount: beforeInfo.applyCount + 1, heat: beforeInfo.heat };
          }
          
          const burnDelta = (afterEarth._destruction as any).sub(beforeEarth._destruction);
          const userDelta = (afterUserBal as any).sub(beforeUserBal);

          // 解析事件：区分 claim-burn 与 decay-burn
          let claimBurn = BigNumber.from(0);
          let decayBurn = BigNumber.from(0);
          try {
            const iface = meshes.interface;
            for (const lg of rc.logs || []) {
              try {
                const parsed = iface.parseLog(lg);
                if (parsed && parsed.name === "TokensBurned") {
                  const amt = parsed.args.amount as any;
                  const rc2 = parsed.args.reasonCode.toNumber();
                  if (rc2 === 1) claimBurn = claimBurn.add(amt);
                  if (rc2 === 2) decayBurn = decayBurn.add(amt);
                }
                if (parsed && parsed.name === "ClaimCostBurned") {
                  const amt2 = parsed.args.amount as any;
                  claimBurn = claimBurn.add(amt2);
                }
              } catch {}
            }
          } catch {}
          
          // 更新统计
          totalClaimBurn = totalClaimBurn.add(claimBurn);
          totalDecayBurn = totalDecayBurn.add(decayBurn);
          totalBurnCost = totalBurnCost.add(burnDelta);
          if ((userDelta as any).gt(0)) totalIncome = totalIncome.add(userDelta);

          pushLog(
            `✅ ${claimType} ClaimMesh(${id}) | ⛽gas=${fmtGas(gasUsed)} | 💰报价=${fmt(quoteCost)} | 📊申请 ${beforeInfo.applyCount}->${afterInfo.applyCount} | 🔥热度 ${fmt(beforeInfo.heat)}->${fmt(afterInfo.heat)} | 💼余额 ${fmt(beforeUserBal)}->${fmt(afterUserBal)} (Δ${fmt(userDelta)}) | 🔥燃烧: claim=${fmt(claimBurn)} decay=${fmt(decayBurn)} 总Δ=${fmt(burnDelta)}`
          );
        } catch (e: any) {
          const errMsg = String(e.message);
          let errorType = "❓未知错误";
          if (errMsg.includes('Already claim')) {
            errorType = "🔄重复认领";
            if (!myMeshes.includes(id)) {
              myMeshes.push(id);
            }
          } else if (errMsg.includes('insufficient')) {
            errorType = "💸余额不足";
          } else if (errMsg.includes('gas')) {
            errorType = "⛽Gas不足";
          }
          
          pushLog(`❌ ${claimType} ClaimMesh(${id}) 失败 | ${errorType} | 💰报价=${fmt(quoteCost)} | ${errMsg.slice(0,60)}`);
        }
      } else {
        // Withdraw
        totalWithdrawOps++;
        const cur = await meshes.getCurrentDayYear();
        const us = await meshes.getUserState(user.address);
        const weight = us[0];
        const lastProc = us[3];
        
        if ((weight as any).gt(0) && (cur.dayIndex as any).gt(lastProc)) {
          const beforeUserBal = await meshes.balanceOf(user.address);
          const beforeEarth = await meshes.getEarthDashboard();
          
          try {
            const tx = await meshes.connect(user).withdraw({ gasLimit: 450000 });
            const rc = await tx.wait();
            const gasUsed = rc.gasUsed;
            totalGasUsed = totalGasUsed.add(gasUsed);
            successfulWithdraws++;
            
            const afterUserBal = await meshes.balanceOf(user.address);
            const afterEarth = await meshes.getEarthDashboard();
            const got = (afterUserBal as any).sub(beforeUserBal);
            const burnDelta = (afterEarth._destruction as any).sub(beforeEarth._destruction);
            
            if ((got as any).gt(0)) totalIncome = totalIncome.add(got);
            if ((burnDelta as any).gt(0)) totalBurnCost = totalBurnCost.add(burnDelta);
            
            // 解析事件区分
            let claimBurn = BigNumber.from(0);
            let decayBurn = BigNumber.from(0);
            try {
              const iface = meshes.interface;
              for (const lg of rc.logs || []) {
                try {
                  const parsed = iface.parseLog(lg);
                  if (parsed && parsed.name === "TokensBurned") {
                    const amt = parsed.args.amount as any;
                    const rc2 = parsed.args.reasonCode.toNumber();
                    if (rc2 === 1) claimBurn = claimBurn.add(amt);
                    if (rc2 === 2) decayBurn = decayBurn.add(amt);
                  }
                } catch {}
              }
            } catch {}
            
            totalClaimBurn = totalClaimBurn.add(claimBurn);
            totalDecayBurn = totalDecayBurn.add(decayBurn);
            
            pushLog(
              `✅ 💸 withdraw 成功 | ⛽gas=${fmtGas(gasUsed)} | 💼余额 ${fmt(beforeUserBal)}->${fmt(afterUserBal)} (Δ${fmt(got)}) | 🔥燃烧: claim=${fmt(claimBurn)} decay=${fmt(decayBurn)} 总Δ=${fmt(burnDelta)}`
            );
          } catch (e: any) {
            pushLog(`❌ 💸 withdraw 失败 | ${String(e.message).slice(0,80)}`);
          }
        } else {
          pushLog(`⏸️ 跳过withdraw | 不符合条件 (权重=${fmt(weight)} 上次处理=${lastProc.toString()} 当前=${cur.dayIndex.toString()})`);
        }
      }
    } catch (e: any) {
      pushLog(`💥 系统错误: ${String(e.message).slice(0,100)}`);
    }

    // 时间推进：以 1d 为主，辅以 0.5d/1h，贴近日节奏
    const r = Math.random();
    if (r < 0.6) await network.provider.send("evm_increaseTime", [SECONDS_IN_DAY]);
    else if (r < 0.85) await network.provider.send("evm_increaseTime", [SECONDS_IN_DAY / 2]);
    else await network.provider.send("evm_increaseTime", [3600]);
    await network.provider.send("evm_mine", []);

    // 刷新显示
    await drawSummary();
    await new Promise((r: any) => setTimeout(r, 800));
  }

  console.log("退出单用户模拟 (Quit)");
  process.exit(0);
}

main().catch((e: any) => {
  console.error(e);
  process.exit(1);
});