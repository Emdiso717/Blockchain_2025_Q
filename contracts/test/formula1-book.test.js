const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Formula1 Chain Order Book & Everything", function () {
    let owner, user1, user2, user3;
    let ERC20, Points, Formula1, formula1, NFT;

    beforeEach(async () => {
        [owner, user1, user2, user3] = await ethers.getSigners();
        // 1. 部署积分币
        ERC20 = await ethers.getContractFactory("ZJUPoints");
        Points = await ERC20.deploy();
        await Points.deployed();

        // 2. 部署主协议
        Formula1 = await ethers.getContractFactory("Formula1");
        formula1 = await Formula1.deploy(Points.address);
        await formula1.deployed();
        // 3. 配置 NFT 合约实例
        const nftAddress = await formula1.ticket();
        NFT = await ethers.getContractAt("BettingTicket", nftAddress);

        // 4. 领积分
        await Points.connect(owner).mint(await owner.getAddress(), ethers.utils.parseUnits("1000", 18));
        for (let u of [user1, user2, user3]) {
            await Points.connect(owner).mint(await u.getAddress(), ethers.utils.parseUnits("1000", 18));
        }
    });

    it("完整流程与订单簿二级市场可用", async () => {
        // ==== Owner 创建项目 ====
        const options = ["A队胜", "B队胜", "平局"];
        const jackpot = ethers.utils.parseUnits("900", 18);
        await Points.connect(owner).approve(formula1.address, jackpot);
        await formula1.connect(owner).createProject(
            "欧洲杯决赛",
            options,
            Math.floor(Date.now() / 1000) + 3600,
            jackpot
        );
        // ==== 玩家购票前资产 ====
        let balancesBefore = [];
        for (const user of [user1, user2, user3]) {
            const bal = await Points.balanceOf(await user.getAddress());
            balancesBefore.push(bal);
        }
        console.log("【购票前】user1/user2/user3余额:", balancesBefore.map(b => ethers.utils.formatUnits(b, 18)));

        // ==== 玩家购买彩票 ====
        for (const [idx, user] of [[0, user1], [1, user2], [2, user3]]) {
            await Points.connect(user).approve(formula1.address, ethers.utils.parseUnits("300", 18));
            await formula1.connect(user).buyTicket(0, idx, ethers.utils.parseUnits("300", 18));
        }

        // ==== 玩家购票后资产 ====
        let balancesAfter = [];
        for (const user of [user1, user2, user3]) {
            const bal = await Points.balanceOf(await user.getAddress());
            balancesAfter.push(bal);
        }
        console.log("【购票后】user1/user2/user3余额:", balancesAfter.map(b => ethers.utils.formatUnits(b, 18)));

        // ==== 检查票证信息 ====
        expect(await NFT.ownerOf(0)).to.eq(await user1.getAddress());
        expect(await NFT.ownerOf(1)).to.eq(await user2.getAddress());
        expect(await NFT.ownerOf(2)).to.eq(await user3.getAddress());

        // ==== 玩家二级市场挂牌与订单簿 ====
        await NFT.connect(user1).approve(formula1.address, 0);
        await formula1.connect(user1).listTicket(0, ethers.utils.parseUnits("360", 18)); // 高价挂

        await NFT.connect(user2).approve(formula1.address, 1);
        await formula1.connect(user2).listTicket(1, ethers.utils.parseUnits("333", 18)); // 低价挂

        // ==== 查询订单簿（全部挂单情况） ====
        let book = [];
        for (let tokenId of [0, 1, 2]) {
            let price = await formula1.listingPrice(tokenId);
            if (price.gt(0)) book.push({ tokenId, price: price.toString() });
        }
        console.log("当前订单簿（tokenId: price）:", book);

        // ==== user3 买走价格更优的票（应选低价） ====
        await Points.connect(user3).approve(formula1.address, ethers.utils.parseUnits("333", 18));
        await formula1.connect(user3).buyListed(1);
        // NFT归属变更
        expect(await NFT.ownerOf(1)).to.eq(await user3.getAddress());

        // ==== 订单簿刷新（二级市场只剩 tokenId 0） ====
        book = [];
        for (let tokenId of [0, 1, 2]) {
            let price = await formula1.listingPrice(tokenId);
            if (price.gt(0)) book.push({ tokenId, price: price.toString() });
        }
        console.log("最新订单簿:", book);

        // ==== Owner 开奖（设“平局”获胜) ====
        await expect(formula1.connect(owner).settle(0, 2)).to.emit(formula1, "ProjectSettled");

        // ==== 记录开奖后余额 ====
        let bBefore1 = await Points.balanceOf(await user1.getAddress());
        let bBefore2 = await Points.balanceOf(await user2.getAddress());
        let bBefore3 = await Points.balanceOf(await user3.getAddress());

        // ==== 只有选了 option 2 的 tokenId 2（user3）中奖 ====
        await formula1.connect(user3).claim(2); // user3自己持有的票
        // user1, user2的票都不是 option 2，不能领奖
        await expect(formula1.connect(user1).claim(0)).to.be.revertedWith("not winner");
        await expect(formula1.connect(user2).claim(1)).to.be.revertedWith("not owner");

        let bAfter1 = await Points.balanceOf(await user1.getAddress());
        let bAfter2 = await Points.balanceOf(await user2.getAddress());
        let bAfter3 = await Points.balanceOf(await user3.getAddress());

        console.log(`开奖后余额 - user1: ${ethers.utils.formatUnits(bAfter1, 18)}，user2: ${ethers.utils.formatUnits(bAfter2, 18)}，user3: ${ethers.utils.formatUnits(bAfter3, 18)}`);

        // user3 中奖应该收到奖金且余额变化
        expect(bAfter3.gt(bBefore3)).to.be.true;
    });

    it("可以不同价格多档挂牌 & 查询完整订单簿", async () => {
        // 重复部分略...
        await Points.connect(owner).approve(formula1.address, ethers.utils.parseUnits("500", 18));
        await formula1.connect(owner).createProject("奖池测试", ["A", "B"], Math.floor(Date.now() / 1000) + 3600, ethers.utils.parseUnits("500", 18));
        // 多人购票
        for (const u of [user1, user2, user3]) {
            await Points.connect(u).approve(formula1.address, ethers.utils.parseUnits("100", 18));
            await formula1.connect(u).buyTicket(0, 0, ethers.utils.parseUnits("100", 18));
        }
        // 多人以不同价格纷纷把票挂牌
        for (let i = 0; i < 3; ++i) {
            await NFT.connect([user1, user2, user3][i]).approve(formula1.address, i);
            await formula1.connect([user1, user2, user3][i]).listTicket(i, ethers.utils.parseUnits((90 + 10 * i).toString(), 18));
        }
        // 查询所有现挂单
        let book = [];
        for (let tokenId = 0; tokenId < 3; ++tokenId) {
            let price = await formula1.listingPrice(tokenId);
            if (price.gt(0)) book.push({ tokenId, price: price.toString() });
        }
        console.log("完整订单簿（不同价格档）:", book);
        expect(book.length).to.equal(3);
    });
});