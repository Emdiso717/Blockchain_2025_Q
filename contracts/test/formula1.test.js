const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Formula1 Full Flow", function () {
    let owner, user1, user2, user3;
    let ERC20, Points, TicketNFT, Formula1, formula1;

    beforeEach(async () => {
        [owner, user1, user2, user3] = await ethers.getSigners();
        // 部署积分币
        ERC20 = await ethers.getContractFactory("ZJUPoints");
        Points = await ERC20.deploy();
        await Points.deployed();
        // 部署主合约
        Formula1 = await ethers.getContractFactory("Formula1");
        formula1 = await Formula1.deploy(Points.address);
        await formula1.deployed();

        // 给每位用户发一些 ZJU Points
        await Points.connect(owner).mint(await owner.getAddress(), ethers.utils.parseUnits("1000", 18));
        for (let u of [user1, user2, user3]) {
            await Points.connect(owner).mint(await u.getAddress(), ethers.utils.parseUnits("1000", 18));
        }
    });

    it("should let users claim, buy ticket, trade NFT, settle, and claim prize", async () => {
        // ==== owner 创建项目 ====
        const options = ["A胜", "B胜", "平局"];
        const jackpot = ethers.utils.parseUnits("600", 18);
        await Points.connect(owner).approve(formula1.address, jackpot);
        await expect(
            formula1.connect(owner).createProject(
                "决赛竞猜",
                options,
                Math.floor(Date.now() / 1000) + 3600, // 未来1小时
                jackpot
            )
        ).to.emit(formula1, "ProjectCreated");

        // ==== 玩家参与竞猜，购票 ====
        for (const [idx, user] of [[0, user1], [1, user2], [2, user3]]) {
            await Points.connect(user).approve(formula1.address, ethers.utils.parseUnits("200", 18));
            await expect(
                formula1.connect(user).buyTicket(0, idx, ethers.utils.parseUnits("200", 18))
            ).to.emit(formula1, "TicketPurchased");
        }
        // ==== 检查 NFT 归属 ====
        const ticket = await formula1.ticket();
        const NFT = await ethers.getContractAt("BettingTicket", ticket);
        expect(await NFT.ownerOf(0)).to.eq(await user1.getAddress());

        // ==== user1 挂牌销售自己的票 ====
        await formula1.connect(user1).listTicket(0, ethers.utils.parseUnits("300", 18));
        // 新增授权：user1 允许formula1合约转移自己的NFT
        await NFT.connect(user1).approve(formula1.address, 0);
        expect(await formula1.listingPrice(0)).to.eq(ethers.utils.parseUnits("300", 18));

        // ==== user3 买入 user1 的票 ====
        await Points.connect(user3).approve(formula1.address, ethers.utils.parseUnits("300", 18));
        await expect(
            formula1.connect(user3).buyListed(0)
        ).to.emit(formula1, "TicketTraded");
        // NFT归属变更
        expect(await NFT.ownerOf(0)).to.eq(await user3.getAddress());

        // ==== owner 开始结算指定获胜选项 ====
        await expect(
            formula1.connect(owner).settle(0, 2) // 选项2 胜
        ).to.emit(formula1, "ProjectSettled");

        // ==== 赢得的 ticket 才能 claim，且只能 claim 一次 ====
        await expect(
            formula1.connect(user3).claim(2)
        ).to.emit(formula1, "TicketClaimed");
        // 不能重复领奖
        await expect(
            formula1.connect(user3).claim(2)
        ).to.be.revertedWith("claimed");
        // 没中奖的不能领
        await expect(
            formula1.connect(user2).claim(1)
        ).to.be.revertedWith("not winner");
    });

    it("should not allow non-owners to create project or settle", async () => {
        const options = ["A", "B"];
        await expect(
            formula1.connect(user1).createProject("非法", options, Math.floor(Date.now() / 1000) + 3600, ethers.utils.parseUnits("100", 18))
        ).to.be.revertedWithCustomError(formula1, "OwnableUnauthorizedAccount");
    });

    it("cannot buy listed NFT by yourself", async () => {
        const options = ["A", "B"];
        await Points.connect(owner).approve(formula1.address, ethers.utils.parseUnits("200", 18));
        await formula1.connect(owner).createProject("PK", options, Math.floor(Date.now() / 1000) + 3600, ethers.utils.parseUnits("200", 18));
        await Points.connect(user1).approve(formula1.address, ethers.utils.parseUnits("200", 18));
        await formula1.connect(user1).buyTicket(0, 1, ethers.utils.parseUnits("200", 18));
        await formula1.connect(user1).listTicket(0, ethers.utils.parseUnits("100", 18));
        await expect(
            formula1.connect(user1).buyListed(0)
        ).to.be.revertedWith("self");
    });

    it("cannot buy a ticket without enough point approve", async () => {
        const options = ["A", "B"];
        await Points.connect(owner).approve(formula1.address, ethers.utils.parseUnits("200", 18));
        await formula1.connect(owner).createProject("PK", options, Math.floor(Date.now() / 1000) + 3600, ethers.utils.parseUnits("200", 18));
        await Points.connect(user2).approve(formula1.address, ethers.utils.parseUnits("200", 18));
        await formula1.connect(user2).buyTicket(0, 0, ethers.utils.parseUnits("200", 18));
        await formula1.connect(user2).listTicket(0, ethers.utils.parseUnits("300", 18));
        // user3 没approve或资金不足时购买
        await expect(
            formula1.connect(user3).buyListed(0)
        ).to.be.reverted;
    });
});