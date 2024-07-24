import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  // Set long timeout for the stress tests.
  mocha: {
    timeout: 60 * 60 * 1000,
  },
  networks: {
    localhost: {
      // Default Hardhat node
      url: "http://localhost:8545",
    },
    localhost_proxy: {
      // Test proxy for the Hardhat node
      url: "http://localhost:8546",
    },
  },
};

export default config;
