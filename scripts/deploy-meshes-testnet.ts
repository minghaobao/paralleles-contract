import { ethers } from "hardhat";

async function main() {
  console.log("=== 开始部署 MESH 代币合约到 BSC Testnet ===");
  
  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("部署者地址:", deployer.address);
  
  // 检查部署者余额
  const balance = await deployer.getBalance();
  console.log("部署者余额:", ethers.utils.formatEther(balance), "BNB");
  
  if (balance.lt(ethers.utils.parseEther("0.01"))) {
    throw new Error("部署者余额不足，至少需要 0.01 BNB");
  }
  
  // 部署 MESH 代币合约
  console.log("正在部署 MESH 代币合约...");
  const Meshes = await ethers.getContractFactory("Meshes");
  
  // 使用部署者地址作为治理 Safe 地址（测试环境）
  const meshes = await Meshes.deploy(deployer.address);
  
  console.log("等待合约部署确认...");
  await meshes.deployed();
  
  console.log("✅ MESH 代币合约部署成功!");
  console.log("合约地址:", meshes.address);
  console.log("交易哈希:", meshes.deployTransaction.hash);
  
  // 验证合约部署
  console.log("\n=== 验证合约部署 ===");
  try {
    const name = await meshes.name();
    const symbol = await meshes.symbol();
    const decimals = await meshes.decimals();
    const totalSupply = await meshes.totalSupply();
    
    console.log("代币名称:", name);
    console.log("代币符号:", symbol);
    console.log("小数位数:", decimals);
    console.log("总供应量:", ethers.utils.formatEther(totalSupply));
    
    console.log("✅ 合约验证成功!");
  } catch (error) {
    console.error("❌ 合约验证失败:", error);
  }
  
  // 保存部署信息
  const deploymentInfo = {
    network: "bsctest",
    contractName: "Meshes",
    address: meshes.address,
    deployer: deployer.address,
    transactionHash: meshes.deployTransaction.hash,
    blockNumber: meshes.deployTransaction.blockNumber,
    timestamp: new Date().toISOString(),
    gasUsed: meshes.deployTransaction.gasLimit?.toString(),
  };
  
  console.log("\n=== 部署信息 ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // 保存到文件
  const fs = require('fs');
  const path = require('path');
  const deploymentsDir = path.join(__dirname, '../deployments/bsctest');
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const filePath = path.join(deploymentsDir, 'Meshes.json');
  fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
  console.log("部署信息已保存到:", filePath);
  
  console.log("\n=== 部署完成 ===");
  console.log("MESH 代币地址:", meshes.address);
  console.log("请将此地址用于 SimpleSwap 合约部署");
  
  // 给部署者铸造一些测试代币
  console.log("\n=== 铸造测试代币 ===");
  try {
    // 铸造 1,000,000 MESH 给部署者
    const mintAmount = ethers.utils.parseEther("1000000");
    console.log("正在铸造 1,000,000 MESH 给部署者...");
    
    // 注意：这里需要调用铸造函数，但需要检查 Meshes 合约是否有公开的铸造函数
    // 如果没有，可能需要通过其他方式获取代币
    console.log("请手动铸造测试代币或通过其他方式获取");
    
  } catch (error) {
    console.log("铸造代币失败:", error.message);
    console.log("请手动铸造测试代币");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });





