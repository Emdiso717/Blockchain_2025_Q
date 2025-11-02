// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract BettingTicket is ERC721, ERC721URIStorage {
    struct TicketInfo {
        uint256 projectId;
        uint256 optionId;
        uint256 amount;
    }

    mapping(uint256 => TicketInfo) public tickets;
    uint256 private _nextTokenId;

    constructor() ERC721("BettingTicket", "BTK") {}

    function mint(
        address to,
        uint256 projectId,
        uint256 optionId,
        uint256 amount
    ) public returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        tickets[tokenId] = TicketInfo({
            projectId: projectId,
            optionId: optionId,
            amount: amount
        });

        return tokenId;
    }

    // 重写必要的函数
    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
