// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ZJUPoints is ERC20, Ownable {
    constructor() ERC20("ZJU Points", "ZJUP") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet() external {
        _mint(msg.sender, 10_000 * 10 ** decimals());
    }
}
