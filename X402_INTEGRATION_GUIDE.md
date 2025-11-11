# X402支付网关集成指南

## 概述

本指南说明如何将X402支付系统与MESH代币系统集成，实现用户通过稳定币支付自动获得MESH并完成Claim操作。

## 架构设计

### 支付流程

```
用户 → 前端选择X402支付 → X402支付系统 → 支付完成 → 回调合约 → 
自动分发MESH → 自动Claim网格 → 完成
```

### 关键组件

1. **X402PaymentGateway合约**：处理支付回调，分发MESH，执行Claim
2. **FoundationManage合约**：管理MESH代币储备
3. **Meshes合约**：执行Claim操作
4. **X402支付系统**：处理稳定币支付

## 部署步骤

### 1. 部署合约

```bash
npx hardhat run scripts/deploy-x402-gateway.ts --network <network>
```

### 2. 配置稳定币汇率

```solidity
// 设置USDT汇率：1 USDT = 1000 MESH
await gateway.setStablecoinConfig(
    usdtAddress,           // USDT合约地址
    ethers.utils.parseEther("1000"),  // 汇率
    true                   // 启用
);

// 设置USDC汇率
await gateway.setStablecoinConfig(
    usdcAddress,
    ethers.utils.parseEther("1000"),
    true
);
```

### 3. 设置X402验证地址

```solidity
await gateway.setX402Verifier(x402SystemAddress);
```

### 4. 授权FoundationManage

确保FoundationManage合约已将PaymentGateway添加为approvedInitiator：

```solidity
await foundationManage.setApprovedInitiator(gatewayAddress, true);
await foundationManage.setApprovedRecipient(userAddress, true);
```

## X402系统集成

### 支付回调格式

X402系统需要在支付完成后调用合约的`processPayment`函数：

```solidity
function processPayment(
    address _user,              // 支付用户地址
    address _stablecoinToken,    // 稳定币合约地址
    uint256 _amount,            // 支付金额
    string memory _meshId,      // 网格ID（可选）
    uint256 _nonce,             // 唯一nonce
    uint256 _timestamp,          // 支付时间戳
    bytes memory _signature      // X402系统签名
)
```

### 签名生成（X402系统端）

```javascript
// Node.js示例
const ethers = require('ethers');

function generatePaymentSignature(
    gatewayAddress,    // PaymentGateway合约地址
    userAddress,       // 用户地址
    stablecoinToken,   // 稳定币地址
    amount,            // 支付金额
    meshId,            // 网格ID
    nonce,             // 唯一nonce
    timestamp,         // 时间戳
    privateKey         // X402系统私钥
) {
    // 构建消息哈希
    const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'address', 'uint256', 'string', 'uint256', 'uint256'],
            [gatewayAddress, userAddress, stablecoinToken, amount, meshId, nonce, timestamp]
        )
    );
    
    // 使用EIP-191前缀
    const ethSignedMessageHash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['string', 'bytes32'],
            ['\x19Ethereum Signed Message:\n32', messageHash]
        )
    );
    
    // 签名
    const wallet = new ethers.Wallet(privateKey);
    const signature = wallet.signMessage(ethers.utils.arrayify(messageHash));
    
    return signature;
}
```

### 支付回调实现（X402系统端）

```javascript
// 当用户支付完成时
async function onPaymentCompleted(paymentInfo) {
    const {
        userId,
        stablecoinToken,
        amount,
        meshId,
        nonce,
        timestamp
    } = paymentInfo;
    
    // 获取用户钱包地址
    const userAddress = await getUserAddress(userId);
    
    // 生成签名
    const signature = generatePaymentSignature(
        gatewayAddress,
        userAddress,
        stablecoinToken,
        amount,
        meshId,
        nonce,
        timestamp,
        x402PrivateKey
    );
    
    // 调用合约
    const gateway = new ethers.Contract(gatewayAddress, gatewayABI, provider);
    const tx = await gateway.processPayment(
        userAddress,
        stablecoinToken,
        amount,
        meshId,
        nonce,
        timestamp,
        signature
    );
    
    await tx.wait();
    console.log('Payment processed:', tx.hash);
}
```

## 前端集成

### 1. 显示支付选项

```javascript
// 在ClaimDialog中添加X402支付选项
function ClaimDialog({ meshId, costBurned, onClaim }) {
  const [paymentMethod, setPaymentMethod] = useState('wallet'); // 'wallet' | 'x402'
  const [selectedStablecoin, setSelectedStablecoin] = useState('USDT');
  
  return (
    <Dialog>
      {/* 选择支付方式 */}
      <RadioGroup value={paymentMethod} onChange={setPaymentMethod}>
        <Radio value="wallet">使用MESH支付</Radio>
        <Radio value="x402">使用X402支付</Radio>
      </RadioGroup>
      
      {paymentMethod === 'x402' && (
        <>
          {/* 选择稳定币 */}
          <Select value={selectedStablecoin} onChange={setSelectedStablecoin}>
            <option value="USDT">USDT</option>
            <option value="USDC">USDC</option>
            <option value="DAI">DAI</option>
          </Select>
          
          {/* 预览MESH数量 */}
          <div>
            <p>将获得: {previewMeshAmount} MESH</p>
          </div>
          
          {/* 启动X402支付 */}
          <Button onClick={handleX402Payment}>
            使用{selectedStablecoin}支付
          </Button>
        </>
      )}
    </Dialog>
  );
}
```

### 2. 预览MESH数量

```javascript
async function previewMeshAmount(stablecoinAddress, amount) {
  const gateway = new ethers.Contract(gatewayAddress, gatewayABI, provider);
  const meshAmount = await gateway.previewMeshAmount(
    stablecoinAddress,
    ethers.utils.parseUnits(amount.toString(), 18)
  );
  return ethers.utils.formatEther(meshAmount);
}
```

### 3. 启动X402支付

```javascript
async function handleX402Payment() {
  // 1. 生成唯一nonce
  const nonce = Date.now();
  
  // 2. 计算需要支付的稳定币金额
  const costInStablecoin = calculateStablecoinAmount(costBurned);
  
  // 3. 启动X402支付流程
  const paymentResult = await x402PaymentSystem.initiatePayment({
    stablecoin: selectedStablecoin,
    amount: costInStablecoin,
    meshId: meshId,
    nonce: nonce,
    callbackUrl: `${API_BASE_URL}/api/x402/callback`
  });
  
  // 4. 监听支付完成事件
  x402PaymentSystem.onPaymentComplete(paymentResult.paymentId, (result) => {
    if (result.success) {
      // 支付完成，等待合约处理
      pollPaymentStatus(result.paymentId);
    }
  });
}
```

### 4. 轮询支付状态

```javascript
async function pollPaymentStatus(paymentId) {
  const maxAttempts = 30;
  let attempts = 0;
  
  const interval = setInterval(async () => {
    attempts++;
    
    try {
      // 查询支付记录
      const payment = await gateway.getPayment(paymentId);
      
      if (payment.processed) {
        clearInterval(interval);
        
        if (payment.claimed) {
          // 自动Claim成功
          toast.success('支付成功！网格已Claim');
          onClaimComplete();
        } else {
          // MESH已分发，但Claim失败，提示用户手动Claim
          toast.warning('支付成功！MESH已到账，请手动Claim网格');
          // 显示手动Claim按钮
        }
      }
    } catch (error) {
      console.error('Error polling payment:', error);
    }
    
    if (attempts >= maxAttempts) {
      clearInterval(interval);
      toast.error('支付处理超时，请检查状态');
    }
  }, 2000); // 每2秒检查一次
}
```

## 后端API集成

### 支付回调端点

```javascript
// pages/api/x402/callback.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const {
    paymentId,
    userId,
    stablecoinToken,
    amount,
    meshId,
    nonce,
    timestamp,
    signature
  } = req.body;
  
  try {
    // 1. 验证支付信息
    const payment = await verifyX402Payment(paymentId);
    
    // 2. 获取用户钱包地址
    const userAddress = await getUserWalletAddress(userId);
    
    // 3. 调用合约处理支付
    const gateway = new ethers.Contract(gatewayAddress, gatewayABI, signer);
    const tx = await gateway.processPayment(
      userAddress,
      stablecoinToken,
      amount,
      meshId,
      nonce,
      timestamp,
      signature
    );
    
    const receipt = await tx.wait();
    
    // 4. 返回结果
    res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      paymentId: paymentId
    });
  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
```

## 安全考虑

### 1. 签名验证

- X402系统必须使用正确的私钥签名
- 合约会验证签名来源
- 消息必须包含合约地址防止跨链重放

### 2. Nonce管理

- 每个支付使用唯一nonce
- Nonce使用后不能再使用
- 建议使用时间戳+随机数生成nonce

### 3. 金额限制

- 设置最小/最大MESH分发数量
- 防止误操作和攻击
- 根据实际情况调整

### 4. 储备余额

- 保持足够的MESH储备
- 低于阈值时暂停自动分发
- 及时补充储备

## 测试

### 1. 单元测试

```bash
npx hardhat test test/X402PaymentGateway.test.ts
```

### 2. 集成测试

测试完整支付流程：
1. 用户发起支付
2. X402系统处理支付
3. 发送回调到合约
4. 验证MESH分发
5. 验证自动Claim

### 3. 压力测试

- 测试批量支付处理
- 测试并发支付
- 测试异常情况处理

## 监控和日志

### 事件监听

```javascript
// 监听支付事件
gateway.on('PaymentProcessed', (paymentId, user, stablecoin, amount, meshAmount, meshId, event) => {
  console.log('Payment processed:', {
    paymentId,
    user,
    stablecoin,
    amount: ethers.utils.formatEther(amount),
    meshAmount: ethers.utils.formatEther(meshAmount),
    meshId
  });
  
  // 更新数据库
  updatePaymentRecord(paymentId, {
    status: 'processed',
    meshAmount: meshAmount.toString()
  });
});

// 监听Claim事件
gateway.on('MeshClaimed', (paymentId, user, meshId, event) => {
  console.log('Mesh claimed:', { paymentId, user, meshId });
  
  // 更新数据库
  updatePaymentRecord(paymentId, {
    status: 'completed',
    claimed: true
  });
});
```

## 故障处理

### 1. 自动Claim失败

如果自动Claim失败，用户可以调用`manualClaimMesh`手动Claim：

```solidity
await gateway.manualClaimMesh(paymentId, meshId);
```

### 2. 支付验证失败

检查：
- 签名是否正确
- Nonce是否重复
- 时间戳是否有效
- 稳定币是否支持

### 3. MESH储备不足

- 及时补充FoundationManage的MESH余额
- 调整`minReserveBalance`
- 暂停自动分发直到补充完成

## 总结

X402PaymentGateway合约实现了：
✅ 支付验证和安全处理
✅ 自动MESH分发
✅ 自动Claim网格
✅ 多种稳定币支持
✅ 完整的支付记录和查询

集成后，用户可以通过稳定币支付轻松获得MESH并完成Claim操作，大大简化了使用流程。

