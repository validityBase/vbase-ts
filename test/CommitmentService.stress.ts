import { expect } from "chai";
import { Signer, zeroPadBytes } from "ethers";
import hre, { ethers, network } from "hardhat";
import pino from "pino";
import { Bytes, Web3 } from "web3";

import artifact, { abi } from "../src/common/contracts/CommitmentService.json";
import { escalatedSendTransaction } from "../src/vbase/transactions";

const TEST_HASH1 = zeroPadBytes("0x01", 32);
const TEST_HASH2 = zeroPadBytes("0xff", 32);
// Use a test address that does not collide with common tests to avoid nonce conflicts:
// Account #19: 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199 (10000 ETH)
const SIGNER_PRIVATE_KEY =
  "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e";

export function encodeFunctionCall(
  web3: Web3,
  functionName: string,
  // web3.eth.abi.encodeFunctionCall() takes any data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
): Bytes {
  // This nonsense is needed due to known web3.js issues:
  // https://github.com/web3/web3.js/issues/6275
  // https://docs.web3js.org/guides/smart_contracts/infer_contract_types_guide/
  const functionAbi = abi.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => item.name === functionName && item.type === "function",
  )[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return web3.eth.abi.encodeFunctionCall(functionAbi as any, data);
}

describe("CommitmentService", () => {
  const logger: pino.Logger = pino({
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
    level: "debug",
  });
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
      logger,
      gasLimit,
    );
  }

  beforeEach(async function () {
    [owner, sender] = await ethers.getSigners();
    const Contract = await ethers.getContractFactory(
      artifact.abi,
      artifact.bytecode,
    );
    commitmentService = await Contract.deploy();
    web3 = new Web3(hre.network.provider);
    ethersWallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, ethers.provider);
    commitmentServiceAddress = await commitmentService.getAddress();
  });

  describe("UserSet", () => {
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

    // Change the block mining interval to 30 seconds (30000 milliseconds).
    // This simulates network contention and a high gas price.
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [30000]);

    // Send the transaction.
    const initialGasPrice = await web3.eth.getGasPrice();
    const data = encodeFunctionCall(web3, "addSet", [TEST_HASH2]).toString();
    const receipt = await escalatedSendTransactionWorker(data);

    // Verify that the transaction has completed at a higher gas price.
    const effectiveGasPrice = receipt?.effectiveGasPrice?.toString() ?? "";
    // receipt.effectiveGasPrice.slice(0, -1) removes the last "n" character.
    expect(
      Number(effectiveGasPrice.slice(0, -1)) / Number(initialGasPrice),
    ).to.be.greaterThan(2);

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
    await expect(escalatedSendTransactionWorker(data, 300000)).to.be.fulfilled;
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
    expect(gasUsed).to.be.finite;
    expect(gasUsed).to.be.greaterThan(44000);
    expect(gasUsed).to.be.lessThan(88000);
  });
});
