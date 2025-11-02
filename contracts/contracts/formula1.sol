// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./NFT.sol"; // BettingTicket
import "./ERC.sol"; // ZJU Points

contract Formula1 is Ownable {
    struct Project {
        string name;
        string[] options;
        uint256 resultTime;
        bool isActive;
        uint256 winningOptionId;
        uint256 poolAmount;
        uint256 winners;
        uint256[] tickets;
    }
    BettingTicket public immutable ticket;
    Project[] public projects;
    // Claim tracking: tokenId => claimed
    mapping(uint256 => bool) public prizeClaimed;
    ZJUPoints public immutable erc;
    mapping(uint256 => uint256) public listingPrice; // tokenId => price

    event ProjectCreated(
        uint256 indexed projectId,
        string name,
        uint256 jackpot,
        uint256 resultTime
    );
    event TicketPurchased(
        uint256 indexed projectId,
        uint256 indexed optionId,
        uint256 indexed tokenId,
        address buyer,
        uint256 amount
    );
    event ProjectSettled(
        uint256 indexed projectId,
        uint256 winningOptionId,
        uint256 winnersCount,
        uint256 prizePerTicket
    );
    event TicketClaimed(
        uint256 indexed projectId,
        uint256 indexed tokenId,
        address claimer,
        uint256 prize
    );
    event TicketListed(uint256 indexed tokenId, uint256 price);
    event TicketDelisted(uint256 indexed tokenId);
    event TicketTraded(
        uint256 indexed tokenId,
        address from,
        address to,
        uint256 price
    );

    constructor(address ercAddress) Ownable(msg.sender) {
        ticket = new BettingTicket();
        erc = ZJUPoints(ercAddress);
    }

    function createProject(
        string memory name_,
        string[] memory options_,
        uint256 resultTime_,
        uint256 jackpotAmount
    ) external onlyOwner returns (uint256 projectId) {
        require(options_.length >= 2, "need >=2 options");
        require(resultTime_ > block.timestamp, "result in future");
        require(jackpotAmount > 0, "jackpot>0");
        // Pull ERC jackpot from owner
        require(
            erc.transferFrom(msg.sender, address(this), jackpotAmount),
            "ERC transfer failed"
        );
        projectId = projects.length;
        projects.push();
        Project storage p = projects[projectId];
        p.name = name_;
        p.options = options_;
        p.resultTime = resultTime_;
        p.isActive = true;
        p.poolAmount = jackpotAmount;

        emit ProjectCreated(projectId, name_, jackpotAmount, resultTime_);
    }

    function _requireBuyable(
        uint256 projectId,
        uint256 optionId
    ) internal view returns (Project storage p) {
        require(projectId < projects.length, "bad projectId");
        p = projects[projectId];
        require(p.isActive, "not active");
        require(block.timestamp < p.resultTime, "closed");
        require(optionId < p.options.length, "bad optionId");
    }
    function _mintTicket(
        address to,
        uint256 projectId,
        uint256 optionId,
        uint256 amount
    ) internal returns (uint256 tokenId) {
        tokenId = ticket.mint(to, projectId, optionId, amount);
        projects[projectId].tickets.push(tokenId);
        emit TicketPurchased(projectId, optionId, tokenId, to, amount);
    }
    function buyTicket(
        uint256 projectId,
        uint256 optionId,
        uint256 amount
    ) external returns (uint256 tokenId) {
        Project storage p = _requireBuyable(projectId, optionId);
        require(amount > 0, "amount>0");
        require(
            erc.transferFrom(msg.sender, address(this), amount),
            "ERC transfer failed"
        );
        p.poolAmount += amount;
        tokenId = _mintTicket(msg.sender, projectId, optionId, amount);
    }

    function settle(
        uint256 projectId,
        uint256 winningOptionId
    ) external onlyOwner {
        require(projectId < projects.length, "bad projectId");
        Project storage p = projects[projectId];
        require(p.isActive, "settled");
        require(winningOptionId < p.options.length, "bad optionId");

        p.isActive = false;
        p.winningOptionId = winningOptionId;

        // Count winners
        uint256 winners;
        uint256 len = p.tickets.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tId = p.tickets[i];
            (, uint256 optId, ) = ticket.tickets(tId);
            if (optId == winningOptionId) {
                winners++;
            }
        }
        p.winners = winners;
        uint256 prizePerTicket = winners == 0 ? 0 : p.poolAmount / winners;
        emit ProjectSettled(
            projectId,
            winningOptionId,
            winners,
            prizePerTicket
        );
    }
    function claim(uint256 tokenId) external {
        require(!prizeClaimed[tokenId], "claimed");
        require(ticket.ownerOf(tokenId) == msg.sender, "not owner");
        (uint256 projectId, uint256 optId, ) = ticket.tickets(tokenId);
        Project storage p = projects[projectId];
        require(!p.isActive, "not settled");
        require(optId == p.winningOptionId, "not winner");

        require(p.winners > 0, "no winners");
        uint256 prize = p.poolAmount / p.winners;
        prizeClaimed[tokenId] = true;
        require(erc.transfer(msg.sender, prize), "ERC transfer failed");

        emit TicketClaimed(projectId, tokenId, msg.sender, prize);
    }

    function listTicket(uint256 tokenId, uint256 price) external {
        require(ticket.ownerOf(tokenId) == msg.sender, "not owner");
        require(price > 0, "price>0");
        listingPrice[tokenId] = price;
        emit TicketListed(tokenId, price);
    }

    function cancelListing(uint256 tokenId) external {
        require(ticket.ownerOf(tokenId) == msg.sender, "not owner");
        require(listingPrice[tokenId] > 0, "not listed");
        delete listingPrice[tokenId];
        emit TicketDelisted(tokenId);
    }

    function buyListed(uint256 tokenId) external {
        uint256 price = listingPrice[tokenId];
        require(price > 0, "not listed");
        address seller = ticket.ownerOf(tokenId);
        require(seller != msg.sender, "self");
        require(erc.transferFrom(msg.sender, seller, price), "ZJUP pay fail");
        ticket.safeTransferFrom(seller, msg.sender, tokenId);
        delete listingPrice[tokenId];
        emit TicketTraded(tokenId, seller, msg.sender, price);
    }

    function getProject(
        uint256 projectId
    )
        external
        view
        returns (
            string memory name,
            string[] memory options,
            uint256 resultTime,
            bool isActive,
            uint256 winningOptionId,
            uint256 poolAmount
        )
    {
        Project storage p = projects[projectId];
        return (
            p.name,
            p.options,
            p.resultTime,
            p.isActive,
            p.winningOptionId,
            p.poolAmount
        );
    }

    // 判断某个票是否中奖
    function isWinningTicket(uint256 tokenId) external view returns (bool) {
        (uint256 projectId, uint256 optId, ) = ticket.tickets(tokenId);
        Project storage p = projects[projectId];
        if (p.isActive) return false; // 项目未开奖，无法判断
        return optId == p.winningOptionId; // 票的选项ID等于中奖选项ID
    }

    // 获取票的详细信息，包括是否中奖
    function getTicketInfo(
        uint256 tokenId
    )
        external
        view
        returns (
            uint256 projectId,
            uint256 optionId,
            uint256 amount,
            bool isWinner,
            bool claimed,
            bool canClaim
        )
    {
        (projectId, optionId, amount) = ticket.tickets(tokenId);
        Project storage p = projects[projectId];
        isWinner = !p.isActive && optionId == p.winningOptionId;
        claimed = prizeClaimed[tokenId];
        canClaim = isWinner && !claimed && p.winners > 0;
    }
}
