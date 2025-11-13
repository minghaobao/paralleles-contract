const fs = require('fs');
const path = require('path');

// 需要提取的合约列表
const contracts = [
  'Meshes',
  'FoundationManage',
  'MeshesTreasury',
  'Reward',
  'Stake',
  'CheckInVerifier',
  'AutomatedExecutor',
  'SafeManager',
  'X402PaymentGateway'
];

// 输出目录（修正到 deploy/management）
const outputDir = path.join(__dirname, '../../deploy/management/src/lib/contracts/artifacts');

// 确保输出目录存在
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 提取合约信息
const contractData = {};

contracts.forEach(contractName => {
  const artifactPath = path.join(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`);
  
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    contractData[contractName] = {
      abi: artifact.abi,
      bytecode: artifact.bytecode
    };
    console.log(`✅ 提取 ${contractName} 合约信息`);
  } else {
    console.log(`❌ 未找到 ${contractName} 合约文件: ${artifactPath}`);
  }
});

// 生成 TypeScript 文件
const tsContent = `// 自动生成的合约 ABI 和字节码文件
// 此文件由 extract-artifacts.js 脚本生成，请勿手动修改

export const CONTRACT_ARTIFACTS = {
${Object.entries(contractData).map(([name, data]) => 
  `  ${name}: {
    abi: ${JSON.stringify(data.abi, null, 2)},
    bytecode: "${data.bytecode}"
  }`
).join(',\n')}
};

// 导出各个合约的 ABI 和字节码
${Object.entries(contractData).map(([name, data]) => 
  `export const ${name.toUpperCase()}_ABI = ${JSON.stringify(data.abi, null, 2)};
export const ${name.toUpperCase()}_BYTECODE = "${data.bytecode}";`
).join('\n')}
`;

// 写入文件
fs.writeFileSync(path.join(outputDir, 'index.ts'), tsContent);
console.log(`✅ 生成合约文件: ${path.join(outputDir, 'index.ts')}`);

// 生成 JSON 文件（备用）
fs.writeFileSync(path.join(outputDir, 'contracts.json'), JSON.stringify(contractData, null, 2));
console.log(`✅ 生成 JSON 文件: ${path.join(outputDir, 'contracts.json')}`);

console.log('\n🎉 合约信息提取完成！');


