import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import { use } from "chai";
import chaiAsPromised from "chai-as-promised";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatNetworkHelpers],
  solidity: "0.8.24",
  test: {
    // Set long timeout for the stress tests.
    mocha: {
      timeout: 60 * 60 * 1000,
      // Register chai-as-promised before tests run (needed for .rejectedWith()).
      // NOTE: Hardhat uses Mocha programmatically (new Mocha(config)), so the
      // 'require' option is silently ignored. rootHooks.beforeAll IS processed by
      // the Mocha constructor and runs before any test suite.
      rootHooks: {
        beforeAll() {
          use(chaiAsPromised);
        },
      },
    },
  },
  networks: {
    localhost: {
      // Default Hardhat node
      type: "http",
      url: "http://localhost:8545",
    },
    localhost_proxy: {
      // Test proxy for the Hardhat node
      type: "http",
      url: "http://localhost:8546",
    },
  },
});
