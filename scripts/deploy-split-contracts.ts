import { ethers } from "hardhat";

async function main() {
  console.log("开始部署拆分后的合约...");

  // 获取部署账户
  const [deployer] = await ethers.getSigners();
  console.log("部署账户:", deployer.address);

  // 配置参数
  const foundationAddr = process.env.FOUNDATION_ADDRESS || "0xDD120c441ED22daC885C9167eaeFFA13522b4644";
  const safeAddress = process.env.SAFE_ADDRESS || "0x0000000000000000000000000000000000000001";
  const initialAPY = parseInt(process.env.INITIAL_APY || "1000"); // 10% APY (1000基点)

  console.log("配置参数:");
  console.log("- 基金会地址:", foundationAddr);
  console.log("- 治理Safe:", safeAddress);
  console.log("- 初始APY:", initialAPY / 100, "%");

  try {
    // 1. 部署Meshes合约
    console.log("\n1. 部署Meshes合约...");
    const Meshes = await ethers.getContractFactory("Meshes");
    const meshes = await Meshes.deploy(foundationAddr, safeAddress);
    await meshes.deployed();
    console.log("Meshes合约已部署到:", meshes.address);

    // 2. 部署Reward合约
    console.log("\n2. 部署Reward合约...");
    const Reward = await ethers.getContractFactory("Reward");
    const reward = await Reward.deploy(meshes.address, foundationAddr, safeAddress);
    await reward.deployed();
    console.log("Reward合约已部署到:", reward.address);

    // 3. 部署Stake合约
    console.log("\n3. 部署Stake合约...");
    const Stake = await ethers.getContractFactory("Stake");
    const stake = await Stake.deploy(meshes.address, foundationAddr, safeAddress, initialAPY);
    await stake.deployed();
    console.log("Stake合约已部署到:", stake.address);

    // 4. 输出部署结果
    console.log("\n=== 部署完成 ===");
    console.log("Meshes合约:", meshes.address);
    console.log("Reward合约:", reward.address);
    console.log("Stake合约:", stake.address);

    // 5. 保存部署信息
    const deploymentInfo = {
      network: "BSC Mainnet",
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: {
        Meshes: {
          address: meshes.address,
          constructorArgs: [foundationAddr, safeAddress]
        },
        Reward: {
          address: reward.address,
          constructorArgs: [meshes.address, foundationAddr, safeAddress]
        },
        Stake: {
          address: stake.address,
          constructorArgs: [meshes.address, foundationAddr, safeAddress, initialAPY]
        }
      },
      configuration: {
        foundationAddr: foundationAddr,
        safeAddress: safeAddress,
        initialAPY: initialAPY
      }
    };

    // 保存到文件
    const fs = require("fs");
    fs.writeFileSync(
      "deployment-split-contracts.json",
      JSON.stringify(deploymentInfo, null, 2)
    );
    console.log("\n部署信息已保存到 deployment-split-contracts.json");

    // 6. 验证合约状态
    console.log("\n=== 合约验证 ===");
    
    // 验证Meshes合约
    const meshTokenName = await meshes.name();
    const meshTokenSymbol = await meshes.symbol();
    console.log("Meshes代币名称:", meshTokenName);
    console.log("Meshes代币符号:", meshTokenSymbol);
    
    // 验证Reward合约
    const rewardFoundation = await reward.foundationAddress();
    const rewardMeshToken = await reward.meshToken();
    console.log("Reward基金会地址:", rewardFoundation);
    console.log("Reward代币地址:", rewardMeshToken);
    
    // 验证Stake合约
    const stakeFoundation = await stake.foundationAddress();
    const stakeMeshToken = await stake.meshToken();
    const stakeAPY = await stake.apy();
    console.log("Stake基金会地址:", stakeFoundation);
    console.log("Stake代币地址:", stakeMeshToken);
    console.log("Stake APY:", stakeAPY / 100, "%");

    console.log("\n所有合约部署和验证完成！");

  } catch (error) {
    console.error("部署过程中发生错误:", error);
    process.exit(1);
  }
}

// 运行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
