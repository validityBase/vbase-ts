import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers, network } from "hardhat";
import { Web3 } from "web3";

import artifact from "../src/common/contracts/CommitmentService.json";
import { escalatedSendTransaction } from "../src/vbase/transactions";
import txSettings from "../src/vbase/txSettings";

import {
  TEST_HASH1,
  TEST_HASH2,
  SIGNER_PRIVATE_KEY,
  LOGGER,
  encodeFunctionCall,
} from "./common";

describe("Transactions", () => {
  // Disable warning for commitmentService: any since we do not have access to the type data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let commitmentService: any;
  let owner: Signer;
  let sender: Signer;
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

  beforeEach(async function () {
    // Reset mining behavior in case it was messed up by prior tests.
    await network.provider.send("evm_setIntervalMining", [0]);
    await network.provider.send("evm_setAutomine", [true]);

    [owner, sender] = await ethers.getSigners();
    const Contract = await ethers.getContractFactory(
      artifact.abi,
      artifact.bytecode,
    );
    commitmentService = await Contract.deploy();
    web3 = new Web3(hre.network.provider);
    ethersWallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, ethers.provider);
    commitmentServiceAddress = await commitmentService.getAddress();
    // Set short gasPriceEscalationInterval for testing.
    txSettings.gasPriceEscalationInterval = 2000;
  });

  describe("CommitmentService", () => {
    it("Executes addSet", async () => {
      await expect(await commitmentService.addSet(TEST_HASH1))
        .to.emit(commitmentService, "AddSet")
        .withArgs(owner, TEST_HASH1);
      expect(
        await commitmentService.verifyUserSets(owner, TEST_HASH1),
      ).to.equal(true);
    });

    it("Executes addSet via sendTransaction", async () => {
      const tx = {
        to: await commitmentService.getAddress(),
        value: 0,
        data: commitmentService.interface.encodeFunctionData("addSet", [
          TEST_HASH2,
        ]),
      };
      // Send the transaction.
      const response = await sender.sendTransaction(tx);
      // Wait for the transaction to be confirmed.
      await response.wait();
      // Check the user sets.
      expect(
        await commitmentService.verifyUserSets(sender, TEST_HASH2),
      ).to.equal(true);
    });
  });

  it("Executes addSet via escalatedSendTransaction", async () => {
    const data = encodeFunctionCall(web3, "addSet", [TEST_HASH2]).toString();
    await escalatedSendTransactionWorker(data);
    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH2),
    ).to.equal(true);
  });

  it("Executes addSet via escalatedSendTransaction with a long block time", async () => {
    // Wait for a block to be mined.
    // This is necessary to make sure the contract is deployed.
    // Without this we will disable mining before the contract is deployed
    // and call a missing contract.
    await network.provider.send("evm_mine");

    // Change the block mining interval to a long window to simulate low gas price.
    const BLOCK_TIME = 10000;
    // This simulates network contention and a high gas price.
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [BLOCK_TIME]);

    // Send the transaction.
    const initialGasPrice =
      Number(await web3.eth.getGasPrice()) * txSettings.gasPriceInitialFactor;
    const data = encodeFunctionCall(web3, "addSet", [TEST_HASH2]).toString();
    const receipt = await escalatedSendTransactionWorker(data);

    // Verify that the transaction has completed at a higher gas price.
    // We can't perform strict accounting since the timeouts,
    // block times, and gas escalation intervals are approximate.
    const effectiveGasPrice = receipt?.effectiveGasPrice?.toString() ?? "";
    // receipt.effectiveGasPrice.slice(0, -1) removes the last "n" character.
    // Add 1 to the effective gas price to account for rounding errors.
    expect(
      Number(effectiveGasPrice.slice(0, -1) + 1) / initialGasPrice,
    ).to.be.greaterThanOrEqual(txSettings.gasPriceEscalationFactor);

    // Check the user sets.
    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH2),
    ).to.equal(true);

    // Reset mining behavior.
    await network.provider.send("evm_setIntervalMining", [0]);
    await network.provider.send("evm_setAutomine", [true]);
  });

  it("Executes addSet and addSetObject", async () => {
    // All txs have to be submitted via encodeFunctionCall()
    // to have the provider track nonces properly.
    let data = encodeFunctionCall(web3, "addSet", [TEST_HASH1]).toString();
    await escalatedSendTransactionWorker(data, 300000);
    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH1),
    ).to.equal(true);
    data = encodeFunctionCall(web3, "addSetObject", [
      TEST_HASH1,
      TEST_HASH2,
    ]).toString();
    await escalatedSendTransactionWorker(data, 300000);
    expect(
      await commitmentService.verifyUserSetObjectsCidSum(
        ethersWallet.address,
        TEST_HASH1,
        TEST_HASH2,
      ),
    ).to.equal(true);
  });

  it("Fails via escalatedSendTransaction with low gas", async () => {
    let data = encodeFunctionCall(web3, "addSet", [TEST_HASH1]).toString();
    await escalatedSendTransactionWorker(data, 300000);
    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH1),
    ).to.equal(true);
    // Fail due to low gas limit.
    data = encodeFunctionCall(web3, "addSetObject", [
      TEST_HASH1,
      TEST_HASH2,
    ]).toString();
    await expect(escalatedSendTransactionWorker(data, 1000)).to.be.rejectedWith(
      Error,
      /Failed to send transaction after/,
    );
  });

  it("Succeeds via escalatedSendTransaction after gas escalation", async () => {
    let data = encodeFunctionCall(web3, "addSet", [TEST_HASH1]).toString();
    await escalatedSendTransactionWorker(data, 300000);
    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH1),
    ).to.equal(true);
    // This needs to be a large transaction so that the gas limit is exceeded.
    // Succeed eventually after doubling the gas limit.
    data = encodeFunctionCall(web3, "addSetObject", [
      TEST_HASH1,
      TEST_HASH2,
    ]).toString();
    const receipt = await escalatedSendTransactionWorker(
      data,
      22000, // Transaction requires at least 21344 gas to be submitted.
    );
    // Verify that the transaction has completed at a higher gas limit
    // following doublings.
    // gasUsed is number represented as a string with a trailing "n".
    const gasUsed = Number(String(receipt.gasUsed).slice(0, -1));
    expect(gasUsed).to.be.greaterThan(44000);
    expect(gasUsed).to.be.lessThan(88000);
  });
});
