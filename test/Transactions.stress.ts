import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { Web3 } from "web3";

import artifact from "../src/common/contracts/CommitmentService.json";
import { escalatedSendTransaction } from "../src/vbase/transactions";
import txSettings from "../src/vbase/txSettings";

import {
  TEST_HASH2,
  SIGNER_PRIVATE_KEY,
  LOGGER,
  encodeFunctionCall,
} from "./common";

describe("CommitmentService", () => {
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

  describe("UserSet", () => {
    it("Executes addSet via escalatedSendTransaction", async () => {
      const data = encodeFunctionCall(web3, "addSet", [TEST_HASH2]).toString();
      await escalatedSendTransactionWorker(data);
      expect(
        await commitmentService.verifyUserSets(
          ethersWallet.address,
          TEST_HASH2,
        ),
      ).to.equal(true);
    });
  });
});
