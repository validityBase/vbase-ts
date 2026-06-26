import { expect } from "chai";
import { Signer, zeroPadBytes } from "ethers";
import hre, { ethers, network } from "hardhat";
import { setNextBlockBaseFeePerGas } from "@nomicfoundation/hardhat-network-helpers";
import { Web3 } from "web3";

import { TransactionReceipt } from "web3-types";

import artifact from "../src/common/contracts/CommitmentService.json";
import {
  escalatedSendTransaction,
  sendTxAndWaitForHash,
  isNonceError,
  isReplacementUnderpricedError,
  isGasError,
  isReceiptSuccessful,
  isReceiptReverted,
  capGasPrice,
  mulGasPriceByFactor,
  getCompletedTxReceipt,
} from "../src/vbase/transactions";
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

  it("Executes addSet via escalatedSendTransaction with a long block time in parallel", async () => {
    // Set a long block interval as in the above test.
    // The interval of 2 seconds is short enough
    // to trigger retries yet complete the txs with their retry logic.
    await network.provider.send("evm_mine");
    const BLOCK_TIME = 2000;
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [BLOCK_TIME]);
    const initialGasPrice =
      Number(await web3.eth.getGasPrice()) * txSettings.gasPriceInitialFactor;

    // Run the transactions in parallel.
    const promises = Array.from({ length: 4 }, async (_, i) => {
      let setHash = web3.utils.toHex(i + 1);
      // Make sure the hash is a valid byte string of even length.
      if (setHash.length % 2 !== 0) {
        setHash = "0x0" + setHash.slice(2);
      }
      setHash = zeroPadBytes(setHash, 32);
      console.log(`Sending tx ${i} with hash ${setHash}`);
      const data = encodeFunctionCall(web3, "addSet", [setHash]).toString();
      return await escalatedSendTransactionWorker(data);
    });
    const receipts = await Promise.all(promises);

    // Verify that the txs have completed.
    receipts.forEach((receipt) => {
      const effectiveGasPrice = receipt?.effectiveGasPrice?.toString() ?? "";
      expect(
        Number(effectiveGasPrice.slice(0, -1) + 1) / initialGasPrice,
      ).to.be.greaterThanOrEqual(txSettings.gasPriceEscalationFactor);
    });

    // Check the user sets.
    expect(
      await commitmentService.verifyUserSets(
        ethersWallet.address,
        zeroPadBytes("0x0A", 32),
      ),
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
    // Fail due to a gas limit that is too low to ever execute the tx.
    // Pin nSendTxRetries so the starting gas limit is reliably below the
    // ~21344 intrinsic-gas floor even after all doublings:
    //   20 * 2^(10-1) = 10240 < 21344.
    // Without pinning, an env-var override of nSendTxRetries >= 12 would let
    // the doubled gas limit exceed the floor, causing the tx to succeed and
    // the test to fail non-deterministically.
    const savedNSendTxRetries = txSettings.nSendTxRetries;
    txSettings.nSendTxRetries = 10;
    data = encodeFunctionCall(web3, "addSetObject", [
      TEST_HASH1,
      TEST_HASH2,
    ]).toString();
    try {
      await expect(escalatedSendTransactionWorker(data, 20)).to.be.rejectedWith(
        Error,
        /Failed to send transaction after/,
      );
    } finally {
      txSettings.nSendTxRetries = savedNSendTxRetries;
    }
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

  it("Executes addSet via escalatedSendTransaction with a gas spike", async () => {
    // This test is similar to the test above, but with a gas spike.
    await network.provider.send("evm_mine");

    // Set a long enough block time to get a gas spike after the tx is submitted.
    const BLOCK_TIME = 2000;
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [BLOCK_TIME]);

    const initialGasPrice =
      Number(await web3.eth.getGasPrice()) * txSettings.gasPriceInitialFactor;

    // Spike the gas price halfway through the block time.
    setTimeout(async () => {
      console.log("> Spiking gas price...");
      const newGasPrice = initialGasPrice * 8;
      await setNextBlockBaseFeePerGas(newGasPrice);
      console.log(
        "< Spiked gas price: initialGasPrice = " +
          initialGasPrice +
          ", newGasPrice = " +
          newGasPrice,
      );
    }, BLOCK_TIME / 2);

    const data = encodeFunctionCall(web3, "addSet", [TEST_HASH2]).toString();
    const receipt = await escalatedSendTransactionWorker(data);

    const effectiveGasPrice = receipt?.effectiveGasPrice?.toString() ?? "";
    expect(
      Number(effectiveGasPrice.slice(0, -1) + 1) / initialGasPrice,
    ).to.be.greaterThanOrEqual(txSettings.gasPriceEscalationFactor);

    expect(
      await commitmentService.verifyUserSets(ethersWallet.address, TEST_HASH2),
    ).to.equal(true);

    await network.provider.send("evm_setIntervalMining", [0]);
    await network.provider.send("evm_setAutomine", [true]);
  });
});

// Pure-function unit tests for the transaction error classification and gas
// helpers. These are deliberately outside the "Transactions" describe so they
// do not pay the per-test contract deployment cost.
describe("Transaction helpers", () => {
  describe("isReplacementUnderpricedError", () => {
    it("detects the ethers REPLACEMENT_UNDERPRICED error code", () => {
      expect(
        isReplacementUnderpricedError({
          code: "REPLACEMENT_UNDERPRICED",
          message: "replacement fee too low",
        }),
      ).to.equal(true);
    });

    it("detects the ethers 'replacement fee too low' message", () => {
      expect(
        isReplacementUnderpricedError(
          new Error("replacement fee too low (transaction=..., code=...)"),
        ),
      ).to.equal(true);
    });

    it("detects the geth/Bor 'replacement transaction underpriced' message", () => {
      expect(
        isReplacementUnderpricedError(
          new Error("replacement transaction underpriced"),
        ),
      ).to.equal(true);
    });

    it("matches a capitalized provider message only via the ethers error code", () => {
      // Some providers (e.g. Hardhat) return a capitalized, generic message that
      // also mentions the nonce and does NOT set the ethers error code. We rely
      // on the ethers error code (present in production) to classify these,
      // rather than broad case-insensitive matching, so that generic/genuine
      // nonce-collision errors are not misrouted into the gas-bump path and the
      // nonce-based coordination between concurrent sends is preserved.
      const capitalizedMessage =
        "Replacement transaction underpriced. A gasPrice/maxFeePerGas of at " +
        "least 123 is necessary to replace the existing transaction with nonce 5.";
      expect(
        isReplacementUnderpricedError({
          code: "REPLACEMENT_UNDERPRICED",
          message: capitalizedMessage,
        }),
      ).to.equal(true);
      expect(
        isReplacementUnderpricedError(new Error(capitalizedMessage)),
      ).to.equal(false);
    });

    it("does not match unrelated errors", () => {
      expect(
        isReplacementUnderpricedError(new Error("nonce too low")),
      ).to.equal(false);
      expect(
        isReplacementUnderpricedError(new Error("insufficient funds")),
      ).to.equal(false);
    });
  });

  describe("isNonceError", () => {
    it("detects nonce errors case-insensitively", () => {
      expect(isNonceError(new Error("nonce too low"))).to.equal(true);
      expect(
        isNonceError(
          new Error("Nonce too low. Expected nonce to be 10 but got 9."),
        ),
      ).to.equal(true);
    });

    it("does not classify a bare 'replacement fee too low' as a nonce error", () => {
      // This must be handled by the gas-price-bump path, not the nonce path.
      expect(isNonceError(new Error("replacement fee too low"))).to.equal(
        false,
      );
    });

    it("does not match non-nonce errors", () => {
      expect(isNonceError(new Error("insufficient funds"))).to.equal(false);
    });
  });

  describe("isGasError", () => {
    it("detects gas errors case-insensitively", () => {
      expect(isGasError(new Error("intrinsic gas too low"))).to.equal(true);
      expect(isGasError(new Error("Transaction ran out of gas"))).to.equal(
        true,
      );
    });

    it("does not match non-gas errors", () => {
      expect(isGasError(new Error("nonce too low"))).to.equal(false);
    });
  });

  describe("isReceiptSuccessful", () => {
    it("treats an explicit success status as successful", () => {
      for (const status of [1, 1n, "0x1", "1"]) {
        expect(
          isReceiptSuccessful({ status } as unknown as TransactionReceipt),
        ).to.equal(true);
      }
    });

    it("treats a revert status as NOT successful", () => {
      for (const status of [0, 0n, "0x0", "0"]) {
        expect(
          isReceiptSuccessful({ status } as unknown as TransactionReceipt),
        ).to.equal(false);
      }
    });

    it("does not treat the serialized '0n' status string as successful", () => {
      // Regression guard: serializeBigInts() turns 0n into the truthy string
      // "0n". A naive `if (receipt.status)` check would treat a reverted tx as
      // successful; isReceiptSuccessful() must run on the raw status and reject it.
      expect(
        isReceiptSuccessful({
          status: "0n",
        } as unknown as TransactionReceipt),
      ).to.equal(false);
    });
  });

  describe("isReceiptReverted", () => {
    it("treats an explicit revert status as reverted", () => {
      for (const status of [0, 0n, "0x0", "0"]) {
        expect(
          isReceiptReverted({ status } as unknown as TransactionReceipt),
        ).to.equal(true);
      }
    });

    it("treats an explicit success status as NOT reverted", () => {
      for (const status of [1, 1n, "0x1", "1"]) {
        expect(
          isReceiptReverted({ status } as unknown as TransactionReceipt),
        ).to.equal(false);
      }
    });

    it("treats an unknown/missing status as NOT reverted", () => {
      // We only fail fast on an explicit failure status; an ambiguous status is
      // left to the normal polling path rather than reported as a revert.
      expect(isReceiptReverted({} as unknown as TransactionReceipt)).to.equal(
        false,
      );
      expect(
        isReceiptReverted({
          status: undefined,
        } as unknown as TransactionReceipt),
      ).to.equal(false);
    });
  });

  describe("capGasPrice", () => {
    it("clamps a gas price above the backstop to maxGasPrice", () => {
      const maxGasPrice = BigInt(txSettings.maxGasPrice);
      expect(capGasPrice(maxGasPrice * 2n)).to.equal(maxGasPrice);
    });

    it("leaves a gas price at or below the backstop unchanged", () => {
      const maxGasPrice = BigInt(txSettings.maxGasPrice);
      expect(capGasPrice(1n)).to.equal(1n);
      expect(capGasPrice(maxGasPrice)).to.equal(maxGasPrice);
    });
  });

  // Deterministic tests of the send-retry path's "replacement underpriced"
  // recovery, using a mock signer so we control the exact errors and the chain
  // nonce. These exercise the production failure path (a same-nonce tx already
  // in the mempool) without depending on a node's error wording.
  describe("sendTxAndWaitForHash replacement-underpriced recovery", () => {
    const SIGNER_ADDRESS = "0x0000000000000000000000000000000000000001";

    // Build a mock signer whose getTransactionCount returns getNonce() and
    // whose sendTransaction is driven by the provided implementation.
    function makeMockSigner(
      getNonce: () => number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendTransaction: (tx: any) => Promise<{ hash: string }>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
      return {
        provider: {
          getTransactionCount: async () => getNonce(),
        },
        getAddress: async () => SIGNER_ADDRESS,
        sendTransaction,
      };
    }

    function makeReplacementUnderpricedError(): Error {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error: any = new Error("replacement fee too low");
      error.code = "REPLACEMENT_UNDERPRICED";
      return error;
    }

    const defaultNStuckTxConfirmations = txSettings.nStuckTxConfirmations;
    const defaultWaitForSendTxRetryInterval =
      txSettings.waitForSendTxRetryInterval;

    beforeEach(() => {
      // Keep the inter-retry wait short so these tests run fast.
      txSettings.waitForSendTxRetryInterval = 1;
      // Most of these tests exercise the replacement (gas-bump) behavior
      // directly, so collapse the stuck-confirmation gate to a single check.
      // The time-gating behavior itself is covered by its own tests below, which
      // set this explicitly.
      txSettings.nStuckTxConfirmations = 1;
    });

    afterEach(() => {
      txSettings.nStuckTxConfirmations = defaultNStuckTxConfirmations;
      txSettings.waitForSendTxRetryInterval = defaultWaitForSendTxRetryInterval;
    });

    it("replaces a stuck own tx by bumping the gas price at the same nonce", async () => {
      // The chain nonce never advances (our own tx is stuck), so the retry must
      // bump the gas price and resend with the SAME nonce.
      let attempt = 0;
      const signer = makeMockSigner(
        () => 5,
        async () => {
          attempt += 1;
          if (attempt === 1) {
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xreplaced" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, true, LOGGER);

      expect(hash).to.equal("0xreplaced");
      // Same nonce, fee bumped by the escalation factor.
      expect(tx.nonce).to.equal(5);
      expect(tx.gasPrice).to.equal(
        mulGasPriceByFactor(1000n, txSettings.gasPriceEscalationFactor),
      );
    });

    it("moves to the freed nonce without bumping on a concurrent collision", async () => {
      // The chain nonce advances between attempts (a concurrent tx claimed the
      // nonce and confirmed), so the retry must move to the new nonce and must
      // NOT bump the fee (to avoid a replacement-fee war).
      let nonce = 5;
      let attempt = 0;
      const signer = makeMockSigner(
        () => nonce,
        async () => {
          attempt += 1;
          if (attempt === 1) {
            // Simulate the concurrent tx confirming, advancing the nonce.
            nonce = 6;
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xmoved" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, true, LOGGER);

      expect(hash).to.equal("0xmoved");
      expect(tx.nonce).to.equal(6);
      // Fee unchanged.
      expect(tx.gasPrice).to.equal(1000n);
    });

    it("does not evict a healthy pending tx; waits for it to mine, then moves on without bumping", async () => {
      // Regression guard for the concurrency hazard: getNonce() returns the
      // CONFIRMED nonce, so an unchanged nonce does NOT prove our tx is stuck.
      // A healthy pending tx (e.g. a concurrent sibling) holds the nonce for a
      // few checks before mining. With nStuckTxConfirmations = 3 we must wait it
      // out WITHOUT bumping (which would evict it) and move on once it mines.
      txSettings.nStuckTxConfirmations = 3;
      let nonce = 5;
      let attempt = 0;
      const signer = makeMockSigner(
        () => nonce,
        async () => {
          attempt += 1;
          if (attempt <= 2) {
            // The sibling tx is still pending; the confirmed nonce is unchanged.
            throw makeReplacementUnderpricedError();
          }
          if (attempt === 3) {
            // The sibling tx mines now, advancing the confirmed nonce.
            nonce = 6;
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xmoved" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, true, LOGGER);

      expect(hash).to.equal("0xmoved");
      // Moved to the freed nonce; the healthy pending tx was never evicted.
      expect(tx.nonce).to.equal(6);
      expect(tx.gasPrice).to.equal(1000n);
    });

    it("replaces a stuck tx only after nStuckTxConfirmations frozen-nonce checks", async () => {
      // With the nonce frozen across nStuckTxConfirmations checks the tx is
      // genuinely stuck, so we must keep resending at the SAME fee while
      // confirming (not evicting a possibly-healthy tx), then bump to replace.
      txSettings.nStuckTxConfirmations = 3;
      const sentGasPrices: bigint[] = [];
      const signer = makeMockSigner(
        () => 5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (tx: any) => {
          const gasPrice = BigInt(tx.gasPrice.toString());
          sentGasPrices.push(gasPrice);
          if (gasPrice <= 1000n) {
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xreplaced" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, true, LOGGER);

      expect(hash).to.equal("0xreplaced");
      // The first three sends were at the original fee while confirming the tx
      // is stuck; only then did we bump.
      expect(sentGasPrices.slice(0, 3)).to.deep.equal([1000n, 1000n, 1000n]);
      expect(tx.nonce).to.equal(5);
      expect(tx.gasPrice).to.equal(
        mulGasPriceByFactor(1000n, txSettings.gasPriceEscalationFactor),
      );
    });

    it("climbs above a highly-escalated stuck tx without exhausting the retry budget", async () => {
      // A prior call escalated the stuck tx to a high fee, so overtaking it
      // requires more fee bumps than nSendTxRetries. The climb must not be cut
      // short: a fresh tx that reuses the bricked nonce has to keep bumping
      // until it exceeds the stuck tx's fee.
      const startGasPrice = 1000n;
      // Require more doublings (14) than nSendTxRetries (default 10) to clear.
      const requiredGasPrice = startGasPrice * (1n << 14n);
      // Keep the requirement well below the safety cap so it is reached first.
      expect(requiredGasPrice).to.be.lessThan(BigInt(txSettings.maxGasPrice));

      let lastSentGasPrice = 0n;
      const signer = makeMockSigner(
        () => 5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (tx: any) => {
          lastSentGasPrice = BigInt(tx.gasPrice.toString());
          if (lastSentGasPrice <= requiredGasPrice) {
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xclimbed" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: startGasPrice,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, true, LOGGER);

      expect(hash).to.equal("0xclimbed");
      expect(BigInt(tx.gasPrice.toString())).to.be.greaterThan(
        requiredGasPrice,
      );
    });

    it("gives up at the maxGasPrice cap when a stuck tx can never be replaced", async () => {
      // A pathological node that always reports underpriced: the climb must
      // still terminate (bounded by the maxGasPrice cap plus the retry budget)
      // rather than loop forever.
      const signer = makeMockSigner(
        () => 5,
        async () => {
          throw makeReplacementUnderpricedError();
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      await expect(
        sendTxAndWaitForHash(signer, tx, true, LOGGER),
      ).to.be.rejectedWith(Error, /Failed to send transaction after/);
      // The climb was clamped at the safety cap.
      expect(BigInt(tx.gasPrice.toString())).to.equal(
        BigInt(txSettings.maxGasPrice),
      );
    });

    it("bumps the gas price on an escalated send while keeping the nonce", async () => {
      // On an escalated send (initialSend = false) we always bump and keep the
      // nonce to replace our own in-flight tx.
      let attempt = 0;
      const signer = makeMockSigner(
        () => 5,
        async () => {
          attempt += 1;
          if (attempt === 1) {
            throw makeReplacementUnderpricedError();
          }
          return { hash: "0xbumped" };
        },
      );
      const tx = {
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        gasLimit: 21000,
        gasPrice: 1000n,
        nonce: 5,
      };

      const hash = await sendTxAndWaitForHash(signer, tx, false, LOGGER);

      expect(hash).to.equal("0xbumped");
      expect(tx.nonce).to.equal(5);
      expect(tx.gasPrice).to.equal(
        mulGasPriceByFactor(1000n, txSettings.gasPriceEscalationFactor),
      );
    });
  });

  // Deterministic tests of getCompletedTxReceipt()'s outcome classification,
  // using a mock web3 so we control the exact receipt status.
  describe("getCompletedTxReceipt", () => {
    function makeMockWeb3(
      getTransactionReceipt: (
        txHash: string,
      ) => Promise<TransactionReceipt | null>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
      return { eth: { getTransactionReceipt } };
    }

    it("returns the receipt for a successful tx", async () => {
      const web3 = makeMockWeb3(async (txHash) => ({
        status: 1n,
        transactionHash: txHash,
      }));

      const receipt = await getCompletedTxReceipt(web3, [TEST_HASH1], LOGGER);

      expect(receipt).to.not.equal(null);
      expect(receipt!.status).to.equal(1n);
    });

    it("fails fast (throws) when a tracked tx mined but reverted", async () => {
      // A reverted tx consumes the nonce, so same-nonce replacements can never
      // succeed; we must surface this immediately instead of polling to a
      // generic timeout.
      const web3 = makeMockWeb3(async (txHash) => ({
        status: 0n,
        transactionHash: txHash,
      }));

      await expect(
        getCompletedTxReceipt(web3, [TEST_HASH1], LOGGER),
      ).to.be.rejectedWith(Error, /reverted on-chain/);
    });

    it("returns null when no tracked tx has a receipt yet", async () => {
      const web3 = makeMockWeb3(async () => null);

      const receipt = await getCompletedTxReceipt(
        web3,
        [TEST_HASH1, TEST_HASH2],
        LOGGER,
      );

      expect(receipt).to.equal(null);
    });
  });
});
