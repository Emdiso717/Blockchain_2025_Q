import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // 1. 部署 ZJUPoints
  const ERC20 = await ethers.getContractFactory("ZJUPoints");
  const erc = await ERC20.deploy();
  await erc.deployed();
  console.log("ZJUPoints(address):", erc.address);

  // 2. 部署 Formula1，传入 ZJUPoints 合约地址参数
  const Formula1 = await ethers.getContractFactory("Formula1");
  const formula1 = await Formula1.deploy(erc.address);
  await formula1.deployed();
  console.log("Formula1(address):", formula1.address);

  // 3. 查出 BettingTicket 合约地址
  const nft = await formula1.ticket();
  console.log("BettingTicket(address):", nft);

  // 4. 空投：给账户发放初始 ZJUP
  const signers = await ethers.getSigners();
  const totalSigners = signers.length;
  console.log(`\n总共有 ${totalSigners} 个可用账户`);

  // 配置空投参数
  const AIRDROP_COUNT = 10; // 空投账户数量（可以修改这个数字，或者设为 totalSigners.length 给所有账户空投）
  const recipients = signers.slice(0, Math.min(AIRDROP_COUNT, totalSigners)); // 前N个账号
  const amount = ethers.utils.parseUnits("10000", 18);

  console.log(`\n空投 ${recipients.length} 个账户，每个账户 10000 ZJUP:`);
  for (let i = 0; i < recipients.length; i++) {
    const s = recipients[i];
    const addr = await s.getAddress();
    try {
      // 优先尝试 owner.mint(address, amount)
      const tx = await erc.mint(addr, amount);
      await tx.wait();
      console.log(`  [${i + 1}/${recipients.length}] minted to ${addr}`);
    } catch (e: any) {
      try {
        // 若没有 mint 函数，则尝试 faucet 由本人调用
        if (typeof (erc as any).faucet === "function") {
          const tx2 = await erc.connect(s).faucet();
          await tx2.wait();
          console.log(`  [${i + 1}/${recipients.length}] faucet to ${addr}`);
        } else {
          console.log(`  [${i + 1}/${recipients.length}] skip ${addr} (no mint/faucet available)`);
        }
      } catch (e2: any) {
        console.log(`  [${i + 1}/${recipients.length}] failed for ${addr}:`, e2.message || String(e2));
      }
    }
  }
  console.log("\n空投完成！\n");

  // 5. 自动更新前端合约地址
  try {
    const frontendAppPath = path.join(__dirname, "../../frontend/src/App.tsx");
    if (fs.existsSync(frontendAppPath)) {
      console.log("\n正在更新前端合约地址...");
      let content = fs.readFileSync(frontendAppPath, "utf-8");

      // 替换 FORMULA1_ADDRESS
      content = content.replace(
        /const FORMULA1_ADDRESS = "0x[a-fA-F0-9]+";/,
        `const FORMULA1_ADDRESS = "${formula1.address}";`
      );

      // 替换 ERC20_ADDRESS
      content = content.replace(
        /const ERC20_ADDRESS = "0x[a-fA-F0-9]+";/,
        `const ERC20_ADDRESS = "${erc.address}";`
      );

      fs.writeFileSync(frontendAppPath, content, "utf-8");
      console.log("✓ 前端地址已更新！");
      console.log(`  Formula1: ${formula1.address}`);
      console.log(`  ZJUPoints: ${erc.address}`);
    } else {
      console.log(`\n⚠ 前端文件未找到: ${frontendAppPath}`);
      console.log("请手动更新前端地址：");
      console.log(`  FORMULA1_ADDRESS = "${formula1.address}"`);
      console.log(`  ERC20_ADDRESS = "${erc.address}"`);
    }
  } catch (error) {
    console.log("\n⚠ 更新前端地址失败:", (error as Error).message);
    console.log("请手动更新前端地址：");
    console.log(`  FORMULA1_ADDRESS = "${formula1.address}"`);
    console.log(`  ERC20_ADDRESS = "${erc.address}"`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});