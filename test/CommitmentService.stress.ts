import { expect } from "chai";
import { Signer, zeroPadBytes } from "ethers";
import hre, { ethers } from "hardhat";
import * as path from "path";
import pino from "pino";
import { Web3 } from "web3";

import { escalatedSendTransaction } from "../src/vbase/transactions";

export const TEST_HASH1 = zeroPadBytes("0x01", 32);
export const TEST_HASH2 = zeroPadBytes("0xff", 32);

describe("CommitmentService", () => {
  const logger: pino.Logger = pino();
  let commitmentService: any;
  let owner: Signer;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const artifact = require(path.join(
      __dirname,
      "..",
      "src",
      "common",
      "contracts",
      "CommitmentService.json"
    ));
    const Contract = await ethers.getContractFactory(
      artifact.abi,
      artifact.bytecode
    );
    commitmentService = await Contract.deploy();
  });

  describe("UserSet", () => {
    it("Executes addSet", async () => {
      await commitmentService.addSet(TEST_HASH1);
      expect(true).to.equal(true);
    });

    it("Executes addSet via escalatedSendTransaction", async () => {
      const web3 = new Web3(hre.network.provider);
      const ethersWallet = new ethers.Wallet(owner.privateKey, ethers.provider);
      const tx: BaseTransaction;

      escalatedSendTransaction(web3, ethersWallet, tx, logger);
      await commitmentService.addSet(TEST_HASH1);
      expect(true).to.equal(true);
    });
  });
});
