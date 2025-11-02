import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import formula1Abi from "./abi/Formula1.json";
import ercAbi from "./abi/ZJUPoints.json";
import nftAbi from "./abi/BettingTicket.json";

// 声明 window.ethereum 类型
declare global {
    interface Window {
        ethereum?: any;
    }
}

// 填入你的部署地址
const FORMULA1_ADDRESS = "0xEcC1ef3640dB8336fd8E875c5987478a18E9dddD";
const ERC20_ADDRESS = "0xF1411244750eB8Ba49BA1E13A90FE51c2B9985CC";

function App() {
    const [account, setAccount] = useState<string>("");
    const [provider, setProvider] = useState<ethers.providers.Web3Provider>();
    const [signer, setSigner] = useState<ethers.Signer>();
    const [formula1, setFormula1] = useState<ethers.Contract>();
    const [erc, setErc] = useState<ethers.Contract>();
    const [nft, setNft] = useState<ethers.Contract>();
    const [owner, setOwner] = useState<string>("");
    const [isOwner, setIsOwner] = useState<boolean>(false);
    const [status, setStatus] = useState<string>("");
    const [points, setPoints] = useState<string>("0");

    // 表单状态
    const [projName, setProjName] = useState<string>("");
    const [options, setOptions] = useState<string[]>([""]);
    const [resultTimeLocal, setResultTimeLocal] = useState<string>(""); // HTML datetime-local
    const [jackpot, setJackpot] = useState<string>("");

    // 通过事件加载项目列表（兼容无 length 的 public array）
    const [projects, setProjects] = useState<any[]>([]);
    const [myTickets, setMyTickets] = useState<any[]>([]);
    const [listings, setListings] = useState<any[]>([]);
    const [buyAmounts, setBuyAmounts] = useState<Record<string, string>>({});
    const [listPrices, setListPrices] = useState<Record<string, string>>({});
    const [settleProjectId, setSettleProjectId] = useState<number | null>(null);
    const [settleChoice, setSettleChoice] = useState<number>(0);
    const [refreshTrigger, setRefreshTrigger] = useState<number>(0); // 用于手动触发刷新

    // 订单簿：按项目-选项-投资金额分组聚合
    const orderBook = useMemo(() => {
        const book: Record<string, { projectId: number; optionId: number; amount: any; projName: string; optionName: string; orders: any[]; minPrice: string; count: number }> = {};
        listings.forEach(l => {
            // 分组键：项目-选项-投资金额
            const key = `${l.projectId}-${l.optionId}-${l.amount.toString()}`;
            if (!book[key]) {
                book[key] = {
                    projectId: l.projectId,
                    optionId: l.optionId,
                    amount: l.amount, // 彩票投资金额
                    projName: l.projName,
                    optionName: l.optionName,
                    orders: [],
                    minPrice: "", // 将在排序后设置
                    count: 0
                };
            }
            book[key].orders.push(l);
            book[key].count++;
        });
        // 每个分组内的订单按价格排序（使用 BigNumber 比较），然后设置最低价
        Object.keys(book).forEach(key => {
            book[key].orders.sort((a, b) => {
                const aBN = ethers.BigNumber.from(a.price);
                const bBN = ethers.BigNumber.from(b.price);
                if (aBN.lt(bBN)) return -1;
                if (aBN.gt(bBN)) return 1;
                return 0;
            });
            // 排序后，第一个订单就是最低价
            if (book[key].orders.length > 0) {
                book[key].minPrice = book[key].orders[0].price;
            }
        });
        // 按最低价排序所有分组（使用 BigNumber 比较），过滤掉无效的分组
        return Object.values(book)
            .filter(b => b.orders.length > 0 && b.minPrice) // 确保有订单且有最低价
            .sort((a, b) => {
                const aBN = ethers.BigNumber.from(a.minPrice);
                const bBN = ethers.BigNumber.from(b.minPrice);
                if (aBN.lt(bBN)) return -1;
                if (aBN.gt(bBN)) return 1;
                return 0;
            });
    }, [listings]);

    // 初始化连接
    useEffect(() => {
        const init = async () => {
            if (!(window.ethereum && window.ethereum.isMetaMask)) {
                setStatus("请安装并连接 MetaMask");
                return;
            }
            const p = new ethers.providers.Web3Provider(window.ethereum);
            setProvider(p);
            await p.send("eth_requestAccounts", []);
            const s = p.getSigner();
            const addr = await s.getAddress();
            setSigner(s);
            setAccount(addr);
            const f = new ethers.Contract(FORMULA1_ADDRESS, formula1Abi.abi, s);
            const e = new ethers.Contract(ERC20_ADDRESS, ercAbi.abi, s);
            setFormula1(f);
            setErc(e);
            try {
                const o = await f.owner();
                setOwner(o);
                setIsOwner(o.toLowerCase() === addr.toLowerCase());
                const nftAddr = await f.ticket();
                const n = new ethers.Contract(nftAddr, nftAbi.abi, s);
                setNft(n);
            } catch (err) {
                console.error("owner() error", err);
                const net = await p.getNetwork();
                const code = await p.getCode(FORMULA1_ADDRESS);
                console.log("network", net, "codeAtAddr", code);
                setStatus("读取 owner 失败，请检查合约地址与网络");
            }
        };
        init();
    }, []);

    // 读取当前账户积分
    useEffect(() => {
        const load = async () => {
            if (!erc || !account) return;
            try {
                const bal = await erc.balanceOf(account);
                setPoints(ethers.utils.formatUnits(bal, 18));
            } catch (e) {
                // ignore
            }
        };
        load();
    }, [erc, account]);

    const onCreate = async () => {
        if (!isOwner) {
            setStatus("仅 owner 可创建项目");
            return;
        }
        if (!formula1 || !erc) {
            setStatus("合约未加载完成，请稍后再试");
            return;
        }
        const cleanedOptions = options.map(o => o.trim()).filter(o => o.length > 0);
        if (!projName || cleanedOptions.length < 2 || !resultTimeLocal || !jackpot) {
            setStatus("请完整填写表单（至少2个选项）");
            return;
        }
        try {
            setStatus("提交中：授权奖池积分...");
            const jackpotWei = ethers.utils.parseUnits(jackpot, 18);
            const unixTs = Math.floor(new Date(resultTimeLocal).getTime() / 1000);
            const approveTx = await erc.approve(FORMULA1_ADDRESS, jackpotWei);
            await approveTx.wait();
            setStatus("提交中：创建项目...");
            const tx = await formula1.createProject(
                projName,
                cleanedOptions,
                unixTs,
                jackpotWei
            );
            await tx.wait();
            setStatus("项目创建成功！");
            // 清空表单
            setProjName("");
            setOptions([""]);
            setResultTimeLocal("");
            setJackpot("");
            // 刷新积分
            const bal = await erc.balanceOf(account);
            setPoints(ethers.utils.formatUnits(bal, 18));
        } catch (e: any) {
            setStatus("创建失败：" + (e.reason ?? e.message));
        }
    };

    // 事件加载项目
    useEffect(() => {
        const loadProjects = async () => {
            if (!provider || !formula1) return;
            try {
                const iface = new ethers.utils.Interface(formula1Abi.abi);
                const topic = iface.getEventTopic("ProjectCreated");
                const logs = await provider.getLogs({
                    address: FORMULA1_ADDRESS,
                    topics: [topic],
                    fromBlock: 0,
                    toBlock: "latest",
                });
                const ids = Array.from(new Set(logs.map(l => Number(iface.parseLog(l).args.projectId))));
                const items: any[] = [];
                for (const id of ids) {
                    try {
                        const r = await (formula1 as any).getProject(id);
                        items.push({
                            id,
                            name: r[0],
                            options: r[1],
                            resultTime: r[2],
                            isActive: r[3],
                            winningOptionId: Number(r[4]), // 转换为数字
                            poolAmount: r[5]
                        });
                    } catch { }
                }
                items.sort((a, b) => b.id - a.id);
                setProjects(items);
            } catch (e) {
                // ignore
            }
        };
        loadProjects();
    }, [provider, formula1, status]);

    // 加载我的彩票
    useEffect(() => {
        const loadTickets = async () => {
            if (!provider || !formula1 || !nft || !account) return;
            try {
                const iface = new ethers.utils.Interface(formula1Abi.abi);
                // 查找所有可能产生票的事件：TicketPurchased 和 TicketTraded
                const purchasedTopic = iface.getEventTopic("TicketPurchased");
                const tradedTopic = iface.getEventTopic("TicketTraded");
                const purchasedLogs = await provider.getLogs({
                    address: FORMULA1_ADDRESS,
                    topics: [purchasedTopic],
                    fromBlock: 0,
                    toBlock: "latest",
                });
                const tradedLogs = await provider.getLogs({
                    address: FORMULA1_ADDRESS,
                    topics: [tradedTopic],
                    fromBlock: 0,
                    toBlock: "latest",
                });
                // 收集所有涉及的 tokenId
                const purchasedTokenIds = purchasedLogs.map(l => Number(iface.parseLog(l).args.tokenId));
                const tradedTokenIds = tradedLogs.map(l => Number(iface.parseLog(l).args.tokenId));
                const allTokenIds = Array.from(new Set([...purchasedTokenIds, ...tradedTokenIds]));
                const mine: any[] = [];
                for (const tokenId of allTokenIds) {
                    try {
                        const ownerAddr = await nft.ownerOf(tokenId);
                        if (ownerAddr.toLowerCase() === account.toLowerCase()) {
                            const info = await nft.tickets(tokenId);
                            const claimed = await formula1.prizeClaimed(tokenId);
                            mine.push({
                                tokenId,
                                projectId: Number(info[0]), // 转换为数字
                                optionId: Number(info[1]), // 转换为数字
                                amount: info[2],
                                claimed
                            });
                        }
                    } catch { }
                }
                setMyTickets(mine);
            } catch (e) {
                // ignore
            }
        };
        loadTickets();
    }, [provider, formula1, nft, account, status, refreshTrigger]);

    // 加载二级市场挂单
    useEffect(() => {
        const loadListings = async () => {
            if (!provider || !formula1 || !nft || !account || projects.length === 0) return;
            try {
                // 获取当前区块号，确保查询到最新数据
                const currentBlock = await provider.getBlockNumber();
                const iface = new ethers.utils.Interface(formula1Abi.abi);
                const listedTopic = iface.getEventTopic("TicketListed");
                const delistedTopic = iface.getEventTopic("TicketDelisted");
                const tradedTopic = iface.getEventTopic("TicketTraded");
                // 使用当前区块号确保获取最新数据
                const listedLogs = await provider.getLogs({ address: FORMULA1_ADDRESS, topics: [listedTopic], fromBlock: 0, toBlock: currentBlock });
                const delistedLogs = await provider.getLogs({ address: FORMULA1_ADDRESS, topics: [delistedTopic], fromBlock: 0, toBlock: currentBlock });
                const tradedLogs = await provider.getLogs({ address: FORMULA1_ADDRESS, topics: [tradedTopic], fromBlock: 0, toBlock: currentBlock });
                const listed = new Set(listedLogs.map(l => Number(iface.parseLog(l).args.tokenId)));
                const removed = new Set([...delistedLogs.map(l => Number(iface.parseLog(l).args.tokenId)), ...tradedLogs.map(l => Number(iface.parseLog(l).args.tokenId))]);
                const active: any[] = [];
                for (const tokenId of Array.from(listed)) {
                    if (removed.has(tokenId)) continue;
                    try {
                        const price = await formula1.listingPrice(tokenId);
                        if (price.gt(0)) {
                            const ownerAddr = await nft.ownerOf(tokenId);
                            const info = await nft.tickets(tokenId);
                            const proj = projects.find(p => p.id === Number(info[0]));
                            if (proj && proj.isActive) {
                                active.push({
                                    tokenId,
                                    price: price.toString(),
                                    owner: ownerAddr,
                                    projectId: info[0],
                                    optionId: info[1],
                                    amount: info[2], // 彩票投资金额
                                    projName: proj.name,
                                    optionName: proj.options[Number(info[1])]
                                });
                            }
                        }
                    } catch { }
                }
                console.log(`[加载挂单] 从链上查询到 ${active.length} 个挂单`);
                // 合并现有列表和新查询结果，避免丢失刚添加的项
                setListings(prev => {
                    // 创建一个 Map 来去重，优先使用链上查询的最新数据
                    const map = new Map();
                    // 先添加链上查询的结果
                    active.forEach(item => {
                        map.set(item.tokenId, item);
                    });
                    // 再添加现有列表中不在链上结果中的项（可能是刚添加但还未被索引的）
                    prev.forEach(item => {
                        if (!map.has(item.tokenId)) {
                            map.set(item.tokenId, item);
                        }
                    });
                    const merged = Array.from(map.values());
                    console.log(`[加载挂单] 合并列表: 现有 ${prev.length} + 新查询 ${active.length} = 合并后 ${merged.length}`);
                    return merged;
                });
            } catch (e) {
                // ignore
            }
        };
        loadListings();
    }, [provider, formula1, nft, account, projects, status, refreshTrigger]);

    // 用户功能函数
    const onBuyTicket = async (projectId: number, optionId: number) => {
        if (!formula1 || !erc || !account) {
            setStatus("合约未加载");
            return;
        }
        const key = `${projectId}-${optionId}`;
        const amountStr = buyAmounts[key] || "";
        if (!amountStr || Number(amountStr) <= 0) {
            setStatus("请输入购买金额");
            return;
        }
        try {
            setStatus("提交中：购买彩票...");
            const amount = ethers.utils.parseUnits(amountStr, 18);
            const approveTx = await erc.approve(FORMULA1_ADDRESS, amount);
            await approveTx.wait();
            const tx = await formula1.buyTicket(projectId, optionId, amount);
            await tx.wait();
            setStatus("购买成功！");
            setBuyAmounts({ ...buyAmounts, [key]: "" });
            const bal = await erc.balanceOf(account);
            setPoints(ethers.utils.formatUnits(bal, 18));
        } catch (e: any) {
            setStatus("购买失败：" + (e.reason ?? e.message));
        }
    };

    const onListTicket = async (tokenId: number) => {
        if (!formula1 || !nft || !account) {
            setStatus("合约未加载");
            return;
        }
        const priceStr = listPrices[tokenId] || "";
        if (!priceStr || Number(priceStr) <= 0) {
            setStatus("请输入挂单价格");
            return;
        }
        try {
            console.log(`[挂单] 开始挂单 tokenId=${tokenId}, account=${account}`);

            // 检查当前 owner 是否是用户
            let currentOwner: string;
            try {
                currentOwner = await nft.ownerOf(tokenId);
                console.log(`[挂单] NFT ${tokenId} 的当前所有者: ${currentOwner}`);
            } catch (e: any) {
                setStatus(`挂单失败：无法查询 NFT 所有者：${e.message}`);
                console.error("[挂单] 查询 owner 失败:", e);
                return;
            }

            if (currentOwner.toLowerCase() !== account.toLowerCase()) {
                setStatus(`挂单失败：您不是该 NFT 的所有者。当前所有者：${currentOwner.slice(0, 6)}...${currentOwner.slice(-4)}，您的地址：${account.slice(0, 6)}...${account.slice(-4)}。请刷新页面。`);
                console.error(`[挂单] Owner 不匹配: 期望 ${account}, 实际 ${currentOwner}`);
                return;
            }
            console.log(`[挂单] Owner 验证通过`);
            setStatus("提交中：授权NFT...");
            // 先检查是否已经授权，如果没有才授权
            try {
                const approved = await nft.getApproved(tokenId);
                const approvedAddr = approved ? approved.toLowerCase() : "";
                console.log(`[挂单] 当前授权地址: ${approvedAddr || "无"}`);
                if (approvedAddr !== FORMULA1_ADDRESS.toLowerCase()) {
                    console.log(`[挂单] 需要授权 Formula1 合约`);
                    const approveTx = await nft.approve(FORMULA1_ADDRESS, tokenId);
                    await approveTx.wait();
                    console.log(`[挂单] 授权成功`);
                } else {
                    console.log(`[挂单] 已授权，跳过`);
                }
            } catch (e: any) {
                console.error("[挂单] 检查授权失败:", e);
                // 如果查询授权失败（可能tokenId不存在），直接尝试授权
                try {
                    console.log(`[挂单] 尝试直接授权`);
                    const approveTx = await nft.approve(FORMULA1_ADDRESS, tokenId);
                    await approveTx.wait();
                    console.log(`[挂单] 授权成功`);
                } catch (err: any) {
                    const errMsg = err.reason ?? err.message ?? String(err);
                    setStatus("授权失败：" + errMsg);
                    console.error("[挂单] 授权失败:", err);
                    return;
                }
            }
            setStatus("提交中：挂单...");
            const price = ethers.utils.parseUnits(priceStr, 18);
            console.log(`[挂单] 调用 listTicket, tokenId=${tokenId}, price=${priceStr}`);
            const tx = await formula1.listTicket(tokenId, price);
            const receipt = await tx.wait();
            console.log(`[挂单] 挂单交易确认, blockNumber=${receipt.blockNumber}`);
            setStatus("挂单成功！");
            setListPrices({ ...listPrices, [tokenId]: "" });

            // 从 receipt 中读取事件，立即添加到列表中
            console.log(`[挂单] 开始解析 receipt 事件, logs数量=${receipt.logs.length}`);
            try {
                const iface = new ethers.utils.Interface(formula1Abi.abi);
                const listedEvent = receipt.logs.find((log: any) => {
                    try {
                        const parsed = iface.parseLog(log);
                        return parsed && parsed.name === "TicketListed";
                    } catch {
                        return false;
                    }
                });
                console.log(`[挂单] 找到 TicketListed 事件:`, listedEvent ? "是" : "否");
                if (listedEvent && nft && projects.length > 0) {
                    const parsed = iface.parseLog(listedEvent);
                    const newTokenId = Number(parsed.args.tokenId);
                    const newPrice = parsed.args.price.toString();
                    console.log(`[挂单] 解析事件成功: tokenId=${newTokenId}, price=${newPrice}`);
                    try {
                        const ownerAddr = await nft.ownerOf(newTokenId);
                        const info = await nft.tickets(newTokenId);
                        console.log(`[挂单] NFT 信息: projectId=${Number(info[0])}, optionId=${Number(info[1])}, amount=${info[2]}`);
                        const proj = projects.find((p: any) => p.id === Number(info[0]));
                        console.log(`[挂单] 找到项目:`, proj ? `是 (${proj.name}, isActive=${proj.isActive})` : "否");
                        if (proj && proj.isActive) {
                            const newListing = {
                                tokenId: newTokenId,
                                price: newPrice,
                                owner: ownerAddr,
                                projectId: info[0],
                                optionId: info[1],
                                amount: info[2],
                                projName: proj.name,
                                optionName: proj.options[Number(info[1])]
                            };
                            console.log(`[挂单] 准备添加到列表:`, newListing);
                            // 立即更新列表
                            setListings(prev => {
                                // 避免重复
                                if (prev.find(l => l.tokenId === newTokenId)) {
                                    console.log(`[挂单] 列表已存在该 tokenId，跳过`);
                                    return prev;
                                }
                                console.log(`[挂单] ✅ 添加到列表成功，当前列表长度: ${prev.length} -> ${prev.length + 1}`);
                                return [...prev, newListing];
                            });
                        } else {
                            console.warn(`[挂单] 项目不存在或不活跃，无法添加到列表`);
                        }
                    } catch (e) {
                        console.error(`[挂单] 获取 NFT 信息失败:`, e);
                    }
                } else {
                    console.warn(`[挂单] 事件、NFT 合约或项目列表不满足条件:`, {
                        hasEvent: !!listedEvent,
                        hasNft: !!nft,
                        projectsCount: projects.length
                    });
                }
            } catch (e) {
                console.error(`[挂单] 解析 receipt 失败:`, e);
            }

            // 延迟触发完整刷新，但不要立即覆盖新添加的项
            // 等待更长时间确保事件被索引
            setTimeout(() => {
                console.log(`[挂单] 触发完整刷新，当前列表长度应在此时已更新`);
                setRefreshTrigger(prev => prev + 1);
            }, 3000); // 延迟 3 秒，确保链上事件被索引
        } catch (e: any) {
            const errMsg = e.reason ?? e.message ?? String(e);
            setStatus("挂单失败：" + errMsg);
            console.error("[挂单] 挂单失败:", e);
            console.error("[挂单] 错误详情:", {
                tokenId,
                account,
                priceStr,
                error: errMsg
            });
        }
    };

    const onBuyListed = async (tokenId: number, price: string) => {
        if (!formula1 || !erc || !nft || !account) {
            setStatus("合约未加载");
            return;
        }
        try {
            console.log(`[购买] 开始购买挂单的彩票 tokenId=${tokenId}, price=${price}, buyer=${account}`);
            setStatus("提交中：买入彩票...");
            const priceWei = ethers.BigNumber.from(price);
            const approveTx = await erc.approve(FORMULA1_ADDRESS, priceWei);
            await approveTx.wait();
            console.log(`[购买] ERC20 授权完成`);

            const tx = await formula1.buyListed(tokenId);
            const receipt = await tx.wait();
            console.log(`[购买] 购买交易确认, blockNumber=${receipt.blockNumber}`);

            // 立即验证 NFT 所有权
            try {
                const newOwner = await nft.ownerOf(tokenId);
                console.log(`[购买] 购买后 NFT ${tokenId} 的所有者: ${newOwner}`);
                if (newOwner.toLowerCase() !== account.toLowerCase()) {
                    console.warn(`[购买] 警告：购买后所有者不匹配！期望: ${account}, 实际: ${newOwner}`);
                } else {
                    console.log(`[购买] ✅ 购买成功，NFT 所有权已转移`);
                }
            } catch (e) {
                console.error(`[购买] 无法验证 NFT 所有权:`, e);
            }

            setStatus("买入成功！");
            const bal = await erc.balanceOf(account);
            setPoints(ethers.utils.formatUnits(bal, 18));

            // 从 receipt 中读取 TicketTraded 事件，立即更新"我的票"列表
            try {
                const iface = new ethers.utils.Interface(formula1Abi.abi);
                const tradedEvent = receipt.logs.find((log: any) => {
                    try {
                        const parsed = iface.parseLog(log);
                        return parsed && parsed.name === "TicketTraded";
                    } catch {
                        return false;
                    }
                });
                if (tradedEvent && nft) {
                    const parsed = iface.parseLog(tradedEvent);
                    const tradedTokenId = Number(parsed.args.tokenId);
                    try {
                        const ownerAddr = await nft.ownerOf(tradedTokenId);
                        if (ownerAddr.toLowerCase() === account?.toLowerCase()) {
                            const info = await nft.tickets(tradedTokenId);
                            const claimed = await formula1.prizeClaimed(tradedTokenId);
                            const newTicket = {
                                tokenId: tradedTokenId,
                                projectId: Number(info[0]),
                                optionId: Number(info[1]),
                                amount: info[2],
                                claimed
                            };
                            // 立即更新"我的票"列表
                            setMyTickets(prev => {
                                if (prev.find(t => t.tokenId === tradedTokenId)) {
                                    return prev;
                                }
                                return [...prev, newTicket];
                            });
                        }
                    } catch { }
                }
            } catch { }

            // 立即刷新挂单列表（移除已购买的挂单）
            setTimeout(() => {
                setRefreshTrigger(prev => prev + 1);
            }, 500);
        } catch (e: any) {
            setStatus("买入失败：" + (e.reason ?? e.message));
        }
    };

    const onClaim = async (tokenId: number) => {
        if (!formula1) {
            setStatus("合约未加载");
            return;
        }
        try {
            setStatus("提交中：领奖...");
            const tx = await formula1.claim(tokenId);
            await tx.wait();
            setStatus("领奖成功！");
            if (erc && account) {
                const bal = await erc.balanceOf(account);
                setPoints(ethers.utils.formatUnits(bal, 18));
            }
        } catch (e: any) {
            setStatus("领奖失败：" + (e.reason ?? e.message));
        }
    };

    const onClaimPoints = async () => {
        if (!erc) {
            setStatus("合约未加载");
            return;
        }
        try {
            setStatus("提交中：领取积分...");
            const tx = await erc.faucet();
            await tx.wait();
            setStatus("领取成功！获得 10000 ZJUP");
            if (account) {
                const bal = await erc.balanceOf(account);
                setPoints(ethers.utils.formatUnits(bal, 18));
            }
        } catch (e: any) {
            setStatus("领取失败：" + (e.reason ?? e.message));
        }
    };

    // F1 主题样式
    const wrap: React.CSSProperties = {
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%)",
        backgroundImage: "radial-gradient(circle at 20% 50%, rgba(220, 38, 38, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(220, 38, 38, 0.1) 0%, transparent 50%)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
    };
    const card: React.CSSProperties = {
        width: "100%",
        maxWidth: 1200,
        background: "linear-gradient(145deg, #ffffff 0%, #f8f8f8 100%)",
        borderRadius: 20,
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(220, 38, 38, 0.1)",
        color: "#1a1a1a",
        padding: 32,
        fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
        border: "2px solid rgba(220, 38, 38, 0.2)",
        position: "relative",
    };
    const header: React.CSSProperties = {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 24,
        paddingBottom: 16,
        borderBottom: "2px solid rgba(220, 38, 38, 0.2)",
    };
    const badge: React.CSSProperties = {
        background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
        padding: "8px 16px",
        borderRadius: 12,
        fontSize: 12,
        color: "#ffffff",
        border: "none",
        fontWeight: 600,
        boxShadow: "0 4px 12px rgba(220, 38, 38, 0.3)",
    };
    const title: React.CSSProperties = {
        fontSize: 28,
        fontWeight: 800,
        color: "#1a1a1a",
        background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        letterSpacing: "-0.5px",
    };
    const formRow: React.CSSProperties = { display: "flex", gap: 16, marginBottom: 14 };
    const input: React.CSSProperties = {
        flex: 1,
        background: "#ffffff",
        border: "2px solid #e5e7eb",
        borderRadius: 12,
        padding: "12px 16px",
        color: "#1a1a1a",
        outline: "none",
        transition: "all 0.2s ease",
        fontSize: 14,
    };
    const btn: React.CSSProperties = {
        background: isOwner
            ? "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)"
            : "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
        border: "none",
        borderRadius: 12,
        padding: "12px 24px",
        color: "#ffffff",
        fontWeight: 700,
        cursor: "pointer",
        transition: "all 0.2s ease",
        fontSize: 14,
        boxShadow: isOwner
            ? "0 4px 12px rgba(220, 38, 38, 0.4)"
            : "0 4px 12px rgba(0, 0, 0, 0.2)",
    };
    const sub: React.CSSProperties = { fontSize: 14, color: "#6b7280", fontWeight: 500 };

    const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20, marginTop: 20 };
    const chipRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 };
    const chip: React.CSSProperties = {
        background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
        border: "2px solid #dc2626",
        color: "#991b1b",
        padding: "8px 14px",
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
    };
    const statusBadge: React.CSSProperties = {
        padding: "6px 14px",
        borderRadius: 12,
        fontSize: 12,
        background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
        color: "#ffffff",
        border: "none",
        fontWeight: 700,
        boxShadow: "0 2px 8px rgba(220, 38, 38, 0.3)",
    };

    const onSettle = async (projectId: number, optionsList: string[], idx: number) => {
        if (!isOwner || !formula1) {
            setStatus("仅 owner 可开奖");
            return;
        }
        if (isNaN(idx) || idx < 0 || idx >= optionsList.length) {
            setStatus("无效的选项序号");
            return;
        }
        try {
            setStatus(`提交中：开奖项目 #${projectId} → 选项 ${idx}`);
            const tx = await (formula1 as any).settle(projectId, idx);
            await tx.wait();
            setStatus(`项目 #${projectId} 已开奖，选项 ${idx}`);
            setSettleProjectId(null);
        } catch (e: any) {
            setStatus("开奖失败：" + (e.reason ?? e.message));
        }
    };

    return (
        <div style={wrap}>
            <div style={card}>
                <div style={header}>
                    <div>
                        <div style={title}>
                            {isOwner ? "🏎️ F1 管理员控制台" : "🏁 F1 竞猜市场"}
                        </div>
                        <div style={sub}>
                            👤 账户：{account ? account.slice(0, 6) + "..." + account.slice(-4) : "未连接"} ·
                            💰 ZJUP：{points} ·
                            🏆 区块链竞猜平台
                        </div>
                    </div>
                    {!account && (
                        <button
                            style={{ ...btn, background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)" }}
                            onClick={async () => {
                                if (window.ethereum) {
                                    await window.ethereum.request({ method: "eth_requestAccounts" });
                                }
                            }}
                        >
                            🔌 连接钱包
                        </button>
                    )}
                </div>

                {isOwner ? (
                    <>
                        <div style={{ borderTop: "2px solid rgba(220, 38, 38, 0.2)", paddingTop: 24, marginTop: 24 }}>
                            <div style={formRow}>
                                <input
                                    style={input}
                                    placeholder="🏎️ F1 赛事名称（例如：2025 F1 摩纳哥大奖赛）"
                                    value={projName}
                                    onChange={(e) => setProjName(e.target.value)}
                                    onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                />
                            </div>

                            {/* 动态选项输入 */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                                {options.map((opt, idx) => (
                                    <div key={idx} style={{ display: "flex", gap: 8 }}>
                                        <input
                                            style={{ ...input, flex: 1 }}
                                            placeholder={`🏁 选项 ${idx + 1}（例如：Max Verstappen / Lewis Hamilton）`}
                                            value={opt}
                                            onChange={(e) => {
                                                const copy = [...options];
                                                copy[idx] = e.target.value;
                                                setOptions(copy);
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                            onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                        />
                                        <button
                                            style={{
                                                ...btn,
                                                background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                                                color: "#ffffff",
                                                padding: "10px 16px",
                                            }}
                                            onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                                            disabled={options.length <= 1}
                                            onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.boxShadow = "0 6px 16px rgba(239, 68, 68, 0.5)")}
                                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.4)"}
                                        >🗑️ 删除</button>
                                    </div>
                                ))}
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <button
                                        style={{
                                            ...btn,
                                            background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                                            padding: "10px 18px",
                                        }}
                                        onClick={() => setOptions([...options, ""])}
                                        onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(22, 163, 74, 0.5)"}
                                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(22, 163, 74, 0.4)"}
                                    >➕ 添加选项</button>
                                </div>
                            </div>

                            <div style={formRow}>
                                <input
                                    style={input}
                                    type="datetime-local"
                                    value={resultTimeLocal}
                                    onChange={(e) => setResultTimeLocal(e.target.value)}
                                    onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                />
                                <input
                                    style={input}
                                    placeholder="💰 奖池金额（ZJUP，例如：10000）"
                                    value={jackpot}
                                    onChange={(e) => setJackpot(e.target.value)}
                                    onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                />
                            </div>

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                                <button
                                    style={btn}
                                    disabled={!isOwner}
                                    onClick={onCreate}
                                    onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)")}
                                    onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                >🚀 创建 F1 赛事</button>
                            </div>

                            <div style={{ marginTop: 20, color: "#dc2626", minHeight: 22, fontWeight: 600 }}>{status || "💡 准备就绪"}</div>
                            <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13, fontWeight: 500 }}>🔑 Owner 地址：{owner || "—"}</div>

                            {/* Polymarket 风格 · 市场列表 */}
                            <div style={{ marginTop: 32, borderTop: "2px solid rgba(220, 38, 38, 0.2)", paddingTop: 24 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a1a" }}>🏆 F1 赛事列表</div>
                                    <div style={{ ...badge, background: "linear-gradient(135deg, #374151 0%, #1f2937 100%)" }}>共 {projects.length} 场</div>
                                </div>
                                <div style={grid}>
                                    {projects.map((m) => {
                                        const active = m.isActive;
                                        const nowSec = Math.floor(Date.now() / 1000);
                                        const reachedTime = Number(m.resultTime) > 0 && nowSec >= Number(m.resultTime);
                                        const isExpired = !active || reachedTime;
                                        const dt = new Date(Number(m.resultTime) * 1000);
                                        const statusText = isExpired ? "已开奖" : (active ? "进行中" : "已结算");
                                        const showSettleUI = isOwner && active && settleProjectId === m.id;
                                        return (
                                            <div key={m.id} style={{
                                                background: "linear-gradient(145deg, #ffffff 0%, #fafafa 100%)",
                                                border: `2px solid ${isExpired ? "#94a3b8" : "#dc2626"}`,
                                                borderRadius: 16,
                                                padding: 18,
                                                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                                                transition: "transform 0.2s ease",
                                            }}
                                                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                                                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                                            >
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                                    <div style={{ fontWeight: 800, color: "#1a1a1a", fontSize: 16 }}>🏎️ #{m.id} · {m.name}</div>
                                                    <div style={{
                                                        ...statusBadge,
                                                        background: isExpired
                                                            ? "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)"
                                                            : "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)"
                                                    }}>
                                                        {isExpired ? "🏁 " : "🏃 "}{statusText}
                                                    </div>
                                                </div>
                                                <div style={{ marginTop: 6, color: "#4b4f6b", fontSize: 13 }}>开奖时间：{isNaN(dt.getTime()) ? "—" : dt.toLocaleString()}</div>
                                                {isOwner && active && reachedTime && (
                                                    <div style={{ marginTop: 6, color: "#c0392b", fontSize: 13 }}>已到开奖时间，请尽快开奖</div>
                                                )}
                                                <div style={{ marginTop: 6, color: "#4b4f6b", fontSize: 13 }}>奖池：{ethers.utils.formatUnits(m.poolAmount || 0, 18)} ZJUP</div>
                                                <div style={chipRow}>
                                                    {(m.options || []).map((opt: string, i: number) => (
                                                        <div key={i} style={chip}>{opt}</div>
                                                    ))}
                                                </div>
                                                {isOwner && active && !showSettleUI && (
                                                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                                                        <button
                                                            style={{
                                                                background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                                                                border: "none",
                                                                borderRadius: 12,
                                                                padding: "10px 18px",
                                                                color: "#ffffff",
                                                                fontWeight: 700,
                                                                cursor: "pointer",
                                                                boxShadow: "0 4px 12px rgba(220, 38, 38, 0.4)",
                                                                transition: "all 0.2s ease",
                                                            }}
                                                            onClick={() => { setSettleProjectId(m.id); setSettleChoice(0); }}
                                                            onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)"}
                                                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                                        >🏁 开奖</button>
                                                    </div>
                                                )}
                                                {showSettleUI && (
                                                    <div style={{
                                                        marginTop: 16,
                                                        padding: "16px 20px",
                                                        border: "2px solid #dc2626",
                                                        borderRadius: 16,
                                                        background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
                                                        boxShadow: "0 4px 12px rgba(220, 38, 38, 0.2)",
                                                    }}>
                                                        <div style={{ fontWeight: 800, marginBottom: 12, color: "#991b1b", fontSize: 16 }}>🏁 请选择最终答案</div>
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                            {(m.options || []).map((opt: string, idx: number) => (
                                                                <label key={idx} style={{ display: "flex", alignItems: "center", gap: 8, color: "#1b1e2b" }}>
                                                                    <input
                                                                        type="radio"
                                                                        name={`settle-${m.id}`}
                                                                        checked={settleChoice === idx}
                                                                        onChange={() => setSettleChoice(idx)}
                                                                    />
                                                                    <span>{idx}. {opt}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                                                            <button
                                                                style={{
                                                                    background: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
                                                                    border: "none",
                                                                    color: "#ffffff",
                                                                    borderRadius: 12,
                                                                    padding: "10px 18px",
                                                                    fontWeight: 700,
                                                                    cursor: "pointer",
                                                                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                                                                }}
                                                                onClick={() => setSettleProjectId(null)}
                                                                onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.3)"}
                                                                onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)"}
                                                            >取消</button>
                                                            <button
                                                                style={{
                                                                    background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                                                                    border: "none",
                                                                    color: "#ffffff",
                                                                    borderRadius: 12,
                                                                    padding: "10px 18px",
                                                                    fontWeight: 700,
                                                                    cursor: "pointer",
                                                                    boxShadow: "0 4px 12px rgba(220, 38, 38, 0.4)",
                                                                }}
                                                                onClick={() => onSettle(m.id, m.options || [], settleChoice)}
                                                                onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)"}
                                                                onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                                            >🏁 确认开奖</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {/* 用户模式：购买彩票 */}
                        <div style={{ marginTop: 24 }}>
                            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: "#1a1a1a" }}>🏁 进行中的 F1 赛事</div>
                            {Number(points) < 100 && !isOwner && (
                                <div style={{
                                    marginBottom: 20,
                                    padding: "12px 16px",
                                    background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
                                    border: "2px solid #f59e0b",
                                    borderRadius: 12,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center"
                                }}>
                                    <span style={{ color: "#92400e", fontWeight: 600 }}>💰 余额不足，点击领取积分</span>
                                    <button
                                        style={{ ...btn, background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)", padding: "8px 16px", fontSize: 13 }}
                                        onClick={onClaimPoints}
                                        disabled={!erc}
                                    >领取积分</button>
                                </div>
                            )}
                            <div style={grid}>
                                {projects.filter(p => p.isActive && Math.floor(Date.now() / 1000) < Number(p.resultTime)).map((m) => (
                                    <div key={m.id} style={{
                                        background: "linear-gradient(145deg, #ffffff 0%, #fafafa 100%)",
                                        border: "2px solid #dc2626",
                                        borderRadius: 16,
                                        padding: 18,
                                        boxShadow: "0 8px 24px rgba(220, 38, 38, 0.15)",
                                        transition: "transform 0.2s ease",
                                    }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                                    >
                                        <div style={{ fontWeight: 800, color: "#1a1a1a", marginBottom: 12, fontSize: 18 }}>🏎️ #{m.id} · {m.name}</div>
                                        <div style={{ marginBottom: 16, color: "#dc2626", fontSize: 15, fontWeight: 700 }}>💰 奖池：{ethers.utils.formatUnits(m.poolAmount || 0, 18)} ZJUP</div>
                                        {(m.options || []).map((opt: string, idx: number) => {
                                            const key = `${m.id}-${idx}`;
                                            return (
                                                <div key={idx} style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                                                    <div style={{ ...chip, flex: 1 }}>{opt}</div>
                                                    <input
                                                        style={{ ...input, width: 120, padding: "8px 12px", fontSize: 13 }}
                                                        placeholder="💰 金额"
                                                        value={buyAmounts[key] || ""}
                                                        onChange={(e) => setBuyAmounts({ ...buyAmounts, [key]: e.target.value })}
                                                        onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                                        onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                                    />
                                                    <button
                                                        style={{
                                                            ...btn,
                                                            background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                                                            color: "#ffffff",
                                                            padding: "8px 16px",
                                                            fontSize: 13,
                                                        }}
                                                        onClick={() => onBuyTicket(m.id, idx)}
                                                        onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)"}
                                                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                                    >🚀 购买</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 我的彩票 */}
                        <div style={{ marginTop: 32, borderTop: "2px solid rgba(220, 38, 38, 0.2)", paddingTop: 24 }}>
                            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: "#1a1a1a" }}>🎫 我的 F1 彩票 ({myTickets.length})</div>
                            <div style={grid}>
                                {myTickets.map((t) => {
                                    const proj = projects.find(p => p.id === Number(t.projectId));
                                    return (
                                        <div key={t.tokenId} style={{
                                            background: "linear-gradient(145deg, #ffffff 0%, #fafafa 100%)",
                                            border: "2px solid #dc2626",
                                            borderRadius: 16,
                                            padding: 18,
                                            boxShadow: "0 8px 24px rgba(220, 38, 38, 0.15)",
                                            transition: "transform 0.2s ease",
                                        }}
                                            onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                                            onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                                        >
                                            <div style={{ fontWeight: 800, color: "#1a1a1a", marginBottom: 10, fontSize: 16 }}>🎫 NFT #{t.tokenId}</div>
                                            <div style={{ color: "#4b4f6b", fontSize: 13, marginBottom: 8 }}>
                                                {proj ? `项目：${proj.name}` : `项目ID：${t.projectId}`}
                                            </div>
                                            <div style={{ color: "#4b4f6b", fontSize: 13, marginBottom: 8 }}>
                                                选项：{proj ? (proj.options[t.optionId] || `选项${t.optionId}`) : `选项${t.optionId}`} (选项ID: {Number(t.optionId)})
                                            </div>
                                            {proj && !proj.isActive && (
                                                <div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>
                                                    中奖选项ID: {Number(proj.winningOptionId)} | 我的选项ID: {Number(t.optionId)}
                                                </div>
                                            )}
                                            <div style={{ color: "#4b4f6b", fontSize: 13, marginBottom: 12 }}>
                                                金额：{ethers.utils.formatUnits(t.amount || 0, 18)} ZJUP
                                            </div>
                                            {proj && (
                                                <>
                                                    {!proj.isActive && (
                                                        <div style={{
                                                            marginBottom: 12,
                                                            padding: "12px 16px",
                                                            borderRadius: 12,
                                                            background: Number(proj.winningOptionId) === Number(t.optionId)
                                                                ? "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)"
                                                                : "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
                                                            border: `2px solid ${Number(proj.winningOptionId) === Number(t.optionId) ? "#16a34a" : "#dc2626"}`,
                                                            boxShadow: Number(proj.winningOptionId) === Number(t.optionId)
                                                                ? "0 4px 12px rgba(22, 163, 74, 0.2)"
                                                                : "0 4px 12px rgba(220, 38, 38, 0.2)",
                                                        }}>
                                                            <div style={{
                                                                color: Number(proj.winningOptionId) === Number(t.optionId) ? "#15803d" : "#991b1b",
                                                                fontSize: 14,
                                                                fontWeight: 700
                                                            }}>
                                                                {Number(proj.winningOptionId) === Number(t.optionId)
                                                                    ? (t.claimed ? "✅ 已领奖" : "🏆 中奖！可领取奖金")
                                                                    : "❌ 未中奖"
                                                                }
                                                            </div>
                                                            {Number(proj.winningOptionId) === Number(t.optionId) && !t.claimed && (
                                                                <div style={{ color: "#4b4f6b", fontSize: 12, marginTop: 4 }}>
                                                                    奖池总额：{ethers.utils.formatUnits(proj.poolAmount || 0, 18)} ZJUP（将按中奖票数平分）
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                                {proj && !proj.isActive && Number(proj.winningOptionId) === Number(t.optionId) && !t.claimed && (
                                                    <button
                                                        style={{
                                                            ...btn,
                                                            background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                                                            color: "#ffffff",
                                                            padding: "12px 20px",
                                                            fontSize: 15,
                                                            width: "100%",
                                                            fontWeight: 800,
                                                        }}
                                                        onClick={() => onClaim(t.tokenId)}
                                                        onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(22, 163, 74, 0.5)"}
                                                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(22, 163, 74, 0.4)"}
                                                    >🏆 立即领奖</button>
                                                )}
                                                {proj && proj.isActive && (
                                                    <>
                                                        <input
                                                            style={{ ...input, width: 120, padding: "8px 12px", fontSize: 13 }}
                                                            placeholder="挂单价格"
                                                            value={listPrices[t.tokenId] || ""}
                                                            onChange={(e) => setListPrices({ ...listPrices, [t.tokenId]: e.target.value })}
                                                            onFocus={(e) => e.target.style.borderColor = "#dc2626"}
                                                            onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                                                        />
                                                        <button
                                                            style={{
                                                                ...btn,
                                                                background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                                                                color: "#ffffff",
                                                                padding: "8px 16px",
                                                                fontSize: 13,
                                                            }}
                                                            onClick={() => onListTicket(t.tokenId)}
                                                            onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)"}
                                                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                                        >📋 挂单</button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 订单簿 - 二级市场 */}
                        <div style={{ marginTop: 32, borderTop: "2px solid rgba(220, 38, 38, 0.2)", paddingTop: 24 }}>
                            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: "#1a1a1a" }}>📊 二级市场订单簿 ({orderBook.length} 种彩票, 共 {listings.length} 个挂单)</div>
                            <div style={grid}>
                                {orderBook.map((book) => (
                                    <div key={`${book.projectId}-${book.optionId}-${book.amount.toString()}`} style={{
                                        background: "linear-gradient(145deg, #ffffff 0%, #fafafa 100%)",
                                        border: "2px solid #dc2626",
                                        borderRadius: 16,
                                        padding: 18,
                                        boxShadow: "0 8px 24px rgba(220, 38, 38, 0.15)",
                                        transition: "transform 0.2s ease",
                                    }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                                    >
                                        <div style={{ fontWeight: 800, color: "#1a1a1a", marginBottom: 10, fontSize: 18 }}>🏎️ {book.projName}</div>
                                        <div style={{ color: "#dc2626", fontSize: 15, marginBottom: 8, fontWeight: 700 }}>🏁 选项：{book.optionName}</div>
                                        <div style={{ color: "#1a1a1a", fontSize: 14, marginBottom: 14, fontWeight: 600 }}>
                                            💰 投资金额：{ethers.utils.formatUnits(book.amount, 18)} ZJUP
                                        </div>
                                        <div style={{ padding: "16px", background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)", borderRadius: 12, marginBottom: 14, border: "2px solid #dc2626" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                                <span style={{ color: "#991b1b", fontSize: 14, fontWeight: 600 }}>💰 最低价：</span>
                                                <span style={{ color: "#dc2626", fontSize: 18, fontWeight: 800 }}>
                                                    {ethers.utils.formatUnits(book.minPrice, 18)} ZJUP
                                                </span>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span style={{ color: "#991b1b", fontSize: 14, fontWeight: 600 }}>📦 挂单数量：</span>
                                                <span style={{ color: "#dc2626", fontSize: 18, fontWeight: 800 }}>{book.count} 个</span>
                                            </div>
                                        </div>
                                        <button
                                            style={{
                                                ...btn,
                                                background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                                                color: "#ffffff",
                                                width: "100%",
                                                padding: "14px 20px",
                                                fontSize: 15,
                                                fontWeight: 800,
                                            }}
                                            onClick={() => {
                                                // 自动购买最低价的订单
                                                const cheapest = book.orders[0];
                                                onBuyListed(cheapest.tokenId, cheapest.price);
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(220, 38, 38, 0.5)"}
                                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)"}
                                        >🚀 以最优价买入</button>
                                    </div>
                                ))}
                            </div>
                            {orderBook.length === 0 && (
                                <div style={{
                                    textAlign: "center",
                                    padding: "60px 40px",
                                    color: "#6b7280",
                                    fontSize: 16,
                                    background: "linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)",
                                    borderRadius: 16,
                                    border: "2px dashed #d1d5db",
                                }}>
                                    🏁 暂无挂单，等待卖家上架 F1 彩票
                                </div>
                            )}
                        </div>
                    </>
                )}

                <div style={{ marginTop: 14, color: "#6c5ce7", minHeight: 22 }}>{status}</div>
            </div>
        </div>
    );
}

export default App;
