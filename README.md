# F1 区块链竞猜平台 (F1 Blockchain Betting Platform)

<center>
  秦际州 3220105929
</center>

一个基于以太坊的去中心化 F1 大奖赛竞猜平台，支持赛事创建、下注购买、二级市场交易、订单簿和奖金结算等功能。

## 项目介绍

本项目实现了一个去中心化的 F1 大奖赛竞猜系统，灵感来源于 [Polymarket](https://polymarket.com/)。系统允许管理员创建多个 F1 赛事竞猜项目（如分站冠军、年度总冠军、排位赛杆位等），玩家可以下注购买彩票并在比赛开始前进行二级市场交易。所有交易均通过智能合约在区块链上执行，确保透明性和不可篡改性。

### 应用场景

传统 F1 竞猜系统的痛点在于：对于"F1 年度总冠军"这类持续时间长的事件，玩家通常在赛季开始前就下注完成，一旦出现突发状况（如车手受伤、车队换人、技术规则变化等），很多玩家的选择便会失去意义。本系统通过引入二级市场交易功能，让玩家可以在赛季期间随时买卖他们的彩票，应对各种突发情况，大大提升了竞猜游戏的可玩性和灵活性。

### 实现功能
- **ERC20 积分系统**：使用自定义 ZJU Points (ZJUP) 代币进行所有交易，用户在注册完成之后自动获得1w点数量ZJUP。
- **赛事创建**：管理员可以创建多个 F1 赛事竞猜项目（如摩纳哥大奖赛冠军、年度总冠军等）
- **下注购买**：玩家选择支持的选项（车手或车队）并下注，获得 ERC721 NFT 凭证
- **二级市场**：玩家可以在比赛开始前买卖彩票，应对赛季期间的突发状况
- **订单簿系统**：按赛事-选项-投资金额分组显示挂单，支持最优价购买
- **结算与领奖**：管理员可在比赛结束后结算项目，中奖玩家平分奖池
- **美观前端**：设计一个较为美观清晰的前端口界面提供用户使用。


## 技术栈

- **智能合约**：Solidity 0.8.20
- **开发框架**：Hardhat
- **前端框架**：React + TypeScript
- **区块链交互**：Ethers.js v5
- **钱包集成**：MetaMask

## 项目运行

### 前置要求

- Node.js >= 16.0
- npm 或 yarn
- Ganache（本地测试网络）
- MetaMask 浏览器扩展

#### 步骤 1: 启动 Ganache

1. 打开 Ganache 应用
2. 创建新的 workspace 或使用默认网络
3. 记录 RPC 地址（通常是 `http://127.0.0.1:7545`）
4. 确保至少有一个账户有足够的余额

#### 步骤 2: 部署智能合约

1. 进入合约目录：
   ```bash
   cd contracts
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置 Hardhat（如需要）：
   编辑 `hardhat.config.ts`，确保网络配置与 Ganache 匹配：
   
   ```typescript
   networks: {
     ganache: {
       url: "http://127.0.0.1:7545",
       accounts: {
         mnemonic: "your ganache mnemonic" 
       }
     }
   }
   ```

4. 编译合约：
   ```bash
   npx hardhat compile
   ```

5. 部署合约：
   ```bash
   npx hardhat run scripts/deploy.ts --network ganache
   ```

   部署成功后会输出三个合约地址：
   - `ZJUPoints(address)`: ERC20 代币合约地址
   - `Formula1(address)`: 主合约地址
   - `BettingTicket(address)`: ERC721 NFT 合约地址

   部署脚本会自动：
   - 空投 10000 ZJUP 给前 10 个账户
   - 自动更新前端 `App.tsx` 中的合约地址

6. （如果自动更新失败）手动更新前端地址：
   编辑 `frontend/src/App.tsx`，更新以下常量：
   
   ```typescript
   const FORMULA1_ADDRESS = "Formula1合约地址";
   const ERC20_ADDRESS = "ZJUPoints合约地址";
   ```

#### 步骤 3: 配置 MetaMask

1. 添加自定义网络：
   - 网络名称：`Ganache Local`
   - RPC URL：`http://127.0.0.1:7545`
   - 货币符号：`ETH`
2. 导入账户：
   - 从 Ganache 复制部署合约使用的账户私钥（一般导入五个左右）
   - 在 MetaMask 中导入账户
3. 验证连接：
   - 确认 MetaMask 连接到 Ganache 网络
   - 账户应有足够的 ETH（用于 gas）

#### 步骤 4: 准备前端 ABI 文件

1. 从编译产物复制 ABI 文件到前端：
   ```bash
   # 在项目根目录执行
   cp contracts/artifacts/contracts/formula1.sol/Formula1.json frontend/src/abi/
   cp contracts/artifacts/contracts/ERC.sol/ZJUPoints.json frontend/src/abi/
   cp contracts/artifacts/contracts/NFT.sol/BettingTicket.json frontend/src/abi/
   ```

   确保 `frontend/src/abi/` 目录存在，且包含以下文件：
   - `Formula1.json`
   - `ZJUPoints.json`
   - `BettingTicket.json`

#### 步骤 5: 启动前端

1. 进入前端目录：
   ```bash
   cd frontend
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm start
   ```

   前端将在 `http://localhost:3000` 启动

4. 在浏览器中打开应用并连接 MetaMask

## 功能实现分析

### 1. 智能合约架构

#### 1.1 核心合约：Formula1.sol

**主要功能**：

- **赛事管理**：存储和管理所有 F1 赛事竞猜项目
- **下注购买**：玩家下注支持某个选项，获得 ERC721 NFT 凭证
- **二级市场**：实现彩票挂单、取消挂单、购买挂单
- **结算系统**：管理员结算赛事，计算中奖者
- **奖金领取**：中奖玩家领取奖金

**关键数据结构**：
```solidity
struct Project {
    string name;              // 赛事名称
    string[] options;         // 选项列表
    uint256 resultTime;       // 开奖时间（Unix 时间戳）
    bool isActive;           // 是否进行中
    uint256 winningOptionId; // 中奖选项ID
    uint256 poolAmount;      // 奖池总额
    uint256 winners;         // 中奖人数
    uint256[] tickets;       // 关联的所有彩票ID
}
```

**核心函数**：

- `createProject()`: 创建新的 F1 赛事竞猜项目（onlyOwner）
- `buyTicket()`: 下注购买彩票，支持某个选项
- `listTicket()`: 挂单出售彩票
- `cancelListing()`: 取消挂单
- `buyListed()`: 购买已挂单的彩票
- `settle()`: 结算赛事，设定最终结果（onlyOwner）
- `claim()`: 领取奖金

#### 1.2 ERC20 代币：ZJUPoints.sol

**功能**：
- 自定义 ERC20 代币，作为系统内的积分货币（ZJUP）
- `mint()`: 所有者铸造代币（用于空投）
- `faucet()`: 用户可自行领取 10000 ZJUP

#### 1.3 ERC721 NFT：BettingTicket.sol

**功能**：
- 继承 OpenZeppelin ERC721 和 ERC721URIStorage
- 每张彩票对应一个 NFT token
- 存储彩票信息（赛事ID、选项ID、下注金额）

### 2. 二级市场与订单簿

#### 2.1 挂单机制

- 玩家可以将自己的 NFT 以指定价格挂单出售
- 需要先授权 Formula1 合约转移 NFT
- 使用 `mapping(uint256 => uint256) listingPrice` 存储挂单价格
- 支持取消挂单

#### 2.2 订单簿实现

**前端实现**：
- 按 `赛事ID-选项ID-投资金额` 分组聚合订单
- 每个分组显示：
  - 赛事名称和选项名称
  - 下注金额
  - 最低价（最优价格）
  - 挂单数量
- 支持一键购买最优价订单

**排序逻辑**：

- 分组内按价格升序排序
- 分组间按最低价升序排序

### 3. 前端实现

实现如下两个界面，系统自动根据用户的地址来判断用户种类，自动跳转到如下界面：

- 管理员界面：创建赛事、查看所有赛事、结算赛事:

  <img src="assets/image-20251102171733189.png" alt="管理员界面" style="width: 70%; max-width: 1000px;" />

- 用户界面：查看进行中的赛事、下注购买、管理我的票、二级市场交易:

  <img src="assets/image-20251102171759805.png" alt="用户界面1" style="width: 70%; max-width: 1000px;" />

  <img src="assets/image-20251102171811972.png" alt="用户界面2" style="width: 70%; max-width: 1000px;" />

## 效果功能展示

1. **初始状态 - F1 竞猜市场首页**

   <img src="assets/image-20251102171917641.png" alt="初始状态" style="width: 70%; max-width: 1000px;" />

2. **管理员界面 - 创建 F1 赛事**

   <img src="assets/image-20251102172005134.png" alt="创建赛事" style="width: 70%; max-width: 1000px;" />

   - 输入赛事名称、输入选项、设置开奖时间和奖池金额：

     <img src="assets/image-20251102172204385.png" alt="输入表单" style="width: 70%; max-width: 1000px;" />

   - MetaMask 交易确认弹窗：

     <img src="assets/image-20251102172240665.png" alt="MetaMask弹窗" style="width: 40%; max-width: 400px;" />

   - 项目创建成功：

     <img src="assets/image-20251102172355414.png" alt="创建成功" style="width: 80%; max-width: 1200px;" />

3. **用户界面 - 下注购买**
   - F1 赛事列表展示：

     <img src="assets/image-20251102172430608.png" alt="赛事列表" style="width: 70%; max-width: 1000px;" />

   - 选择支持的选项（车手/车队）和购买金额，MetaMask 授权和交易确认：

     <img src="assets/image-20251102172516996.png" alt="购买彩票" style="width: 70%; max-width: 1000px;" />

   - 购买成功，NFT 显示在"我的 F1 彩票"中

     <img src="assets/image-20251102172557411.png" alt="我的彩票" style="width: 60%; max-width: 800px;" />

4. **二级市场 - 挂单**
   - "我的 F1 彩票"列表、输入挂单价格、MetaMask 授权 NFT 和挂单交易确认：

     <img src="assets/image-20251102172721590.png" alt="挂单操作" style="width: 60%; max-width: 800px;" />

   - 挂单出现在订单簿中：

     <img src="assets/image-20251102172734069.png" alt="订单簿显示" style="width: 70%; max-width: 1000px;" />

5. **订单簿展示**
   - 订单簿分组显示、显示最低价和挂单数量

   - 相同彩票多个挂单：

     <img src="assets/image-20251102173127009.png" alt="相同彩票多个挂单" style="width: 70%; max-width: 1000px;" />

   - 多个不同选项的挂单：

     <img src="assets/image-20251102173228050.png" alt="多个不同选项挂单" style="width: 70%; max-width: 1000px;" />

6. **购买挂单**

   - 从订单簿点击"以最优价买入",MetaMask 授权 ERC20 和购买交易确认

     <img src="assets/image-20251102173518414.png" alt="购买挂单" style="width: 70%; max-width: 1000px;" />

   - 购买成功后 NFT 转移到新账户:

     <img src="assets/image-20251102173546202.png" alt="购买后新账户" style="width: 70%; max-width: 1000px;" />

   - 原账户的彩票：

     <img src="assets/image-20251102173618866.png" alt="原账户彩票" style="width: 70%; max-width: 1000px;" />

7. **结算赛事**
   - 管理员界面中的"🏁 开奖"按钮、选择最终答案选项（获胜车手/车队）、结算交易确认：

     <img src="assets/image-20251102173650571.png" alt="结算赛事" style="width: 60%; max-width: 800px;" />

   - 赛事状态变为"已开奖"：

     <img src="assets/image-20251102173714027.png" alt="已开奖状态" style="width: 65%; max-width: 900px;" />

8. **领取奖金**

   - 彩票详情（中奖与未中奖）：

     <img src="assets/image-20251102173807777.png" alt="彩票详情" style="width: 70%; max-width: 1000px;" />

   - 中奖彩票显示"🏆 中奖"状态"、🏆 立即领奖"按钮、MetaMask 交易确认：

     <img src="assets/image-20251102173834317.png" alt="中奖彩票" style="width: 70%; max-width: 1000px;" />

   - 领取成功后 ZJUP 余额增加：

     <img src="assets/image-20251102173857145.png" alt="领取成功" style="width: 70%; max-width: 1000px;" />

## 测试

### 运行合约测试

```bash
cd contracts
npx hardhat test
```

测试文件：
- `test/formula1.test.js`: 基础功能测试
- `test/formula1-book.test.js`: 订单簿和二级市场测试

<img src="assets/image-20251102174344217.png" alt="测试结果" style="width: 80%; max-width: 1200px;" />

## 项目结构

```
ZJU-blockchain-course-2025/
├── contracts/                 # 智能合约
│   ├── contracts/
│   │   ├── formula1.sol      # 主合约（F1 竞猜逻辑）
│   │   ├── ERC.sol           # ZJU Points 代币
│   │   └── NFT.sol           # Betting Ticket NFT
│   ├── scripts/
│   │   └── deploy.ts         # 部署脚本
│   ├── test/
│   │   ├── formula1.test.js
│   │   └── formula1-book.test.js
│   └── hardhat.config.ts
├── frontend/                 # 前端应用
│   ├── src/
│   │   ├── App.tsx           # 主应用组件（F1 主题 UI）
│   │   └── abi/              # 合约 ABI 文件
│   └── package.json
└── README.md
```

## 总结

本次实验在完成了基本功能的基础上，较好完成了bonus功能，并设计了一个简单美观的前端界面。
