import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    ganache: {
      // rpc url, change it according to your ganache configuration
      url: 'http://localhost:7545',
      // the private key of signers, change it according to your ganache user
      accounts: [
        '0x9c7947d99c9259174e8d975d0723c6ab84f4e790de0b6f526f95e0e775f0f7ea',
        '0xbec1471d910c5ca690b2eaffd1d1a18ef9b46bd55043bd44b9d04dd5250521a0',
        '0x9f9bc9eee4232a3ac26f0eb81354a5928ae11c437ad78522eb684843494ff0e2',
        '0x8502a3198f8ebc56d8e03c593e450969ff54d422106b470702e076b78a7c3895',
        '0x9630b70de62616bf5207b22e94f31ea77c9fc3098fbdbbdb08526a9c76ef9e52'
      ]
    },
  },
};

export default config;
