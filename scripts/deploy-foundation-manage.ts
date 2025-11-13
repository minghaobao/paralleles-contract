import { ethers } from "hardhat";

async function main() {
  console.log("=== 开始部署 FoundationManage 合约到 BSC Testnet ===");
  
  // 使用水龙头私钥创建部署者账户
  const FAUCET_PRIVATE_KEY = "0x33cbd8cb0f60a633e5e5e9c128bd4094bf3acd368761b649ea4e15424bf2e2a5";
  const provider = new ethers.providers.JsonRpcProvider("https://data-seed-prebsc-1-s1.binance.org:8545/");
  const deployer = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);
  
  console.log("部署者地址:", deployer.address);
  
  // 检查余额
  let balance = await deployer.getBalance();
  console.log("部署者余额:", ethers.utils.formatEther(balance), "tBNB");
  
  if (balance.lt(ethers.utils.parseEther("0.01"))) {
    console.log("\n⚠️  余额不足，需要获取测试币");
    console.log("请访问: https://testnet.bnbchain.org/faucet-smart");
    console.log("输入地址:", deployer.address);
    return;
  }
  
  console.log("✅ 余额充足，开始部署...");
  
  // 使用部署者地址作为临时的 Safe 地址
  const governanceSafeAddress = deployer.address;
  
  console.log("\n=== 部署 MeshesTreasury 合约 ===");
  console.log("GovernanceSafe地址:", governanceSafeAddress);
  
  // 先部署 MeshesTreasury
  const MeshesTreasury = await ethers.getContractFactory("MeshesTreasury");
  const treasury = await MeshesTreasury.connect(deployer).deploy(governanceSafeAddress);
  await treasury.deployed();
  
  console.log("✅ MeshesTreasury合约部署完成!");
  console.log("Treasury地址:", treasury.address);
  
  console.log("\n=== 部署 FoundationManage 合约 ===");
  
  // 部署 FoundationManage
  const FoundationManage = await ethers.getContractFactory("FoundationManage");
  const foundationManage = await FoundationManage.connect(deployer).deploy(treasury.address);
  await foundationManage.deployed();
  
  console.log("✅ FoundationManage合约部署完成!");
  console.log("FoundationManage地址:", foundationManage.address);
  
  // 验证部署
  try {
    const owner = await foundationManage.owner();
    const treasuryAddress = await foundationManage.treasury();
    console.log("合约Owner:", owner);
    console.log("Treasury地址:", treasuryAddress);
    console.log("部署者地址:", deployer.address);
    console.log("Owner验证:", owner.toLowerCase() === deployer.address.toLowerCase() ? "✅ 正确" : "❌ 错误");
    console.log("Treasury验证:", treasuryAddress.toLowerCase() === treasury.address.toLowerCase() ? "✅ 正确" : "❌ 错误");
  } catch (error) {
    console.log("❌ 验证失败:", error);
  }
  
  // 保存部署信息
  const deploymentInfo = {
    network: "bsctest",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      meshesTreasury: {
        name: "MeshesTreasury",
        address: treasury.address,
        transactionHash: treasury.deployTransaction.hash,
        governanceSafe: governanceSafeAddress
      },
      foundationManage: {
        name: "FoundationManage",
        address: foundationManage.address,
        transactionHash: foundationManage.deployTransaction.hash,
        treasury: treasury.address
      }
    }
  };
  
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(__dirname, '../deployments/bsctest/FoundationManage.json');
  
  // 确保目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ 部署信息已保存到:", outputPath);
  
  console.log("\n🎉 合约部署完成!");
  console.log("请将以下地址更新到 management 项目中:");
  console.log(`MeshesTreasury (BSC Testnet): ${treasury.address}`);
  console.log(`FoundationManage (BSC Testnet): ${foundationManage.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });



