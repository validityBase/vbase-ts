import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { randomBytes } from "crypto";
import { Web3 } from "web3";

import artifact from "../src/common/contracts/CommitmentService.json";
import { escalatedSendTransaction } from "../src/vbase/transactions";
import txSettings from "../src/vbase/txSettings";

import { SIGNER_PRIVATE_KEY, LOGGER, encodeFunctionCall } from "./common";

describe("Transactions", function () {
  // Set timeout for 10 hours (is ms) for a long-running stress test.  
  this.timeout(10 * 60 * 60 * 1000);

  // Disable warning for commitmentService: any since we do not have access to the type data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let commitmentService: any;
  let web3: Web3;
  let ethersWallet: ethers.Wallet;
  let commitmentServiceAddress: string;

  async function escalatedSendTransactionWorker(
    data: string,
    gasLimit?: number,
  ) {
    return await escalatedSendTransaction(
      web3,
      ethersWallet,
      commitmentServiceAddress,
      data,
      LOGGER,
      gasLimit,
    );
  }

  async function callRandomAddObject() {
    const hash = randomBytes(32);
    const data = encodeFunctionCall(web3, "addObject", [hash]).toString();
    let transactionReceipt = await escalatedSendTransactionWorker(data);
    expect(
      await commitmentService.verifyUserObject(
        ethersWallet.address,
        hash,
        (await ethers.provider.getBlock(transactionReceipt.blockHash)).timestamp,
      ),
    ).to.equal(true);
  }

  beforeEach(async function () {
    // Reset mining behavior in case it was messed up by prior tests.
    await network.provider.send("evm_setIntervalMining", [0]);
    await network.provider.send("evm_setAutomine", [true]);

    const Contract = await ethers.getContractFactory(
      artifact.abi,
      artifact.bytecode,
    );
    commitmentService = await Contract.deploy();
    web3 = new Web3(hre.network.provider);
    ethersWallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, ethers.provider);
    commitmentServiceAddress = await commitmentService.getAddress();
    // Set short intervals for stress testing.
    txSettings.gasPriceEscalationInterval = 1000;
    txSettings.txCompletionCheckInterval = 500;
  });

  describe("commitmentService", () => {
    it("escalatedSendTransaction baseline test", async () => {
      await callRandomAddObject();
    });

    it("escalatedSendTransaction loop", async () => {
      // Set up simulated contention and heavy use as in the spec test.
      await network.provider.send("evm_mine");
      await network.provider.send("evm_setAutomine", [false]);

      for (let i = 0; i < 100; i++) {
        // Use a random block time to simulate contention
        // and trigger various race conditions.
        const blockTime = 1000 + Math.floor(Math.random() * 5 * 1000);
        await network.provider.send("evm_setIntervalMining", [blockTime]);
        await callRandomAddObject();
      }

      await network.provider.send("evm_setIntervalMining", [0]);
      await network.provider.send("evm_setAutomine", [true]);
    });
  });
});
