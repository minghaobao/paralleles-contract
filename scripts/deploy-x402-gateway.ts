import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying X402PaymentGateway...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // 从部署信息读取合约地址
  const deploymentDir = path.join(__dirname, "../deployments");
  const networkName = network.name;
  const deploymentFile = path.join(deploymentDir, networkName, "meshes.json");
  
  let meshTokenAddress = "";
  let meshesContractAddress = "";
  let foundationManageAddress = "";

  if (fs.existsSync(deploymentFile)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    meshTokenAddress = deployment.address || deployment.Meshes || "";
    meshesContractAddress = deployment.address || deployment.Meshes || "";
    
    // 查找FoundationManage部署信息
    const foundationFile = path.join(deploymentDir, networkName, "foundation-manage.json");
    if (fs.existsSync(foundationFile)) {
      const foundationDeploy = JSON.parse(fs.readFileSync(foundationFile, "utf8"));
      foundationManageAddress = foundationDeploy.address || "";
    }
  }

  // 如果没有从部署文件读取到，使用环境变量或默认值
  if (!meshTokenAddress) {
    meshTokenAddress = process.env.MESH_TOKEN_ADDRESS || "";
  }
  if (!meshesContractAddress) {
    meshesContractAddress = process.env.MESHES_CONTRACT_ADDRESS || "";
  }
  if (!foundationManageAddress) {
    foundationManageAddress = process.env.FOUNDATION_MANAGE_ADDRESS || "";
  }

  if (!meshTokenAddress || !meshesContractAddress || !foundationManageAddress) {
    throw new Error("Please set MESH_TOKEN_ADDRESS, MESHES_CONTRACT_ADDRESS, and FOUNDATION_MANAGE_ADDRESS");
  }

  // X402验证地址（初始设置为deployer，后续需要更新为实际的X402系统地址）
  const x402Verifier = process.env.X402_VERIFIER_ADDRESS || deployer.address;

  console.log("\nDeployment Configuration:");
  console.log("  Mesh Token:", meshTokenAddress);
  console.log("  Meshes Contract:", meshesContractAddress);
  console.log("  Foundation Manage:", foundationManageAddress);
  console.log("  X402 Verifier:", x402Verifier);

  // 部署X402PaymentGateway
  const X402PaymentGateway = await ethers.getContractFactory("X402PaymentGateway");
  const gateway = await X402PaymentGateway.deploy(
    meshTokenAddress,
    meshesContractAddress,
    foundationManageAddress,
    x402Verifier
  );

  await gateway.deployed();

  console.log("\n✅ X402PaymentGateway deployed to:", gateway.address);

  // 保存部署信息
  const deploymentInfo = {
    network: networkName,
    address: gateway.address,
    deployer: deployer.address,
    meshToken: meshTokenAddress,
    meshesContract: meshesContractAddress,
    foundationManage: foundationManageAddress,
    x402Verifier: x402Verifier,
    timestamp: new Date().toISOString(),
    txHash: gateway.deployTransaction.hash,
  };

  const outputDir = path.join(deploymentDir, networkName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, "x402-payment-gateway.json");
  fs.writeFileSync(outputFile, JSON.stringify(deploymentInfo, null, 2));

  console.log("Deployment info saved to:", outputFile);

  // 配置初始稳定币汇率（示例）
  console.log("\n📝 Configure stablecoins after deployment:");
  console.log("  Example: setStablecoinConfig(usdtAddress, 1000 * 10**18, true)");
  console.log("  Example: setStablecoinConfig(usdcAddress, 1000 * 10**18, true)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

