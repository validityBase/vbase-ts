import { NonceManager, Signer, TransactionRequest } from "ethers";
import { pino } from "pino";
import { Web3 } from "web3";
import { TransactionReceipt } from "web3-types";

import txSettings from "./txSettings";
import { serializeBigInts } from "./utils";

/**
 * Transaction submission is organized into two nested layers:
 *
 * 1. Outer layer — escalatedSendTransaction():
 *    Builds a single transaction with a fixed nonce and an initial gas price,
 *    submits it, then polls for completion. While the transaction is not
 *    confirmed it periodically escalates the gas price and resends the SAME
 *    nonce (a replacement), backing off the polling/escalation intervals under
 *    load. Because any of the previously broadcast replacements may be the one
 *    that ultimately gets mined, it tracks every submitted hash and checks all
 *    of them for a receipt. It gives up after maxGasPriceEscalations attempts.
 *
 * 2. Inner layer — sendTxAndWaitForHash():
 *    Performs a single logical submission (initial or escalated) of the
 *    transaction object and returns its hash, retrying transient submission
 *    errors in place:
 *      - replacement underpriced -> bump gas price, keep the same nonce, resend;
 *      - nonce errors            -> on the initial send refetch the nonce and
 *                                   resend; on an escalated send rethrow so the
 *                                   outer layer can check for prior completion;
 *      - gas (limit) errors      -> increase the gas limit and resend.
 *    It gives up after nSendTxRetries attempts for most errors; productive
 *    "replacement underpriced" fee bumps (where the gas price actually
 *    increases, i.e. still below the maxGasPrice cap) do not count against
 *    this limit so that a climb above a highly-escalated stuck tx is not cut
 *    short by the retry budget.
 *
 * The nonce is fetched from the chain (last confirmed nonce) and deliberately
 * reused across escalations so that escalated sends replace the in-flight
 * transaction rather than creating new ones.
 */

function verifyTx(signer: Signer, tx: TransactionRequest): void {
  // The caller should always set the gasLimit and nonce.
  // using the heuristic in escalatedSendTransaction().
  if (!tx.gasLimit) {
    throw new Error("verifyTx(): gasLimit undefined");
  }
  // The caller should always set the nonce.
  if (tx.nonce === undefined || tx.nonce === null) {
    throw new Error("verifyTx(): nonce undefined");
  }
}

async function getNonce(signer: Signer): Promise<number> {
  if (signer === undefined || signer === null) {
    throw new Error("getNonce(): signer undefined");
  }
  if (signer.provider === undefined || signer.provider === null) {
    throw new Error("getNonce(): signer.provider undefined");
  }

  // Ensure signer is not an instance of NonceManager.
  // NonceManager overrides nonce based on its own logic
  // and breaks nonce reset and transaction retry with higher gas limit.
  if (signer instanceof NonceManager) {
    throw new Error("getNonce(): signer is a NonceManager");
  }

  // One would expect signer.getNonce() to return the correct nonce,
  // but it does not.
  // TODO: Long-term nonce management should be done via a single
  // globally synchronized counter
  // with a check on failure since the following operation is expensive.
  const nonce = await signer.provider.getTransactionCount(signer.getAddress());
  return nonce;
}

async function waitForSendTxRetry(
  attempt: number,
  logger: pino.Logger,
): Promise<void> {
  // Wait for the interval before retrying tx submission.
  // Increase the interval between checks to back off on heavy load.
  // Add a random factor to avoid collisions with other clients.
  const sendTxRetryTimeout =
    attempt * txSettings.waitForSendTxRetryInterval + Math.random();
  logger.debug(
    `waitForSendTxRetry(): sendTxRetryTimeout = ${sendTxRetryTimeout}`,
  );
  await new Promise((resolve) => setTimeout(resolve, sendTxRetryTimeout));
}

// Check if the error is a nonce error.
// We classify errors in the catch block by parsing their messages, matching
// case-insensitively since the wording/capitalization varies across nodes
// (e.g. "nonce too low" vs "Nonce too low").
// Note: "replacement underpriced" errors are intentionally NOT treated as nonce
// errors. They look nonce-related (same-nonce collision) and their messages
// often even mention the nonce, but the correct remedy is to raise the gas
// price, not to change the nonce. They are detected separately by
// isReplacementUnderpricedError() below, which must therefore be checked first.
// Exported for unit testing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNonceError(error: any): boolean {
  // All errors that mention "nonce" in the message are nonce errors.
  return (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("nonce")
  );
}

// Check if the error is a "replacement transaction underpriced" error.
//
// This occurs when a transaction with the same nonce is already in the node's
// mempool (often our own prior, still-pending submission) and our new same-nonce
// transaction does not raise the fee by the node's required price bump
// (Polygon Bor's default is 10%, applied to BOTH maxFeePerGas and
// maxPriorityFeePerGas). It is NOT a nonce problem: getTransactionCount() keeps
// reporting this nonce as next-valid because the pending tx is unconfirmed, so
// refetching the nonce does not help and incrementing it would only queue an
// unexecutable tx behind the stuck one. The correct remedy is to bump the gas
// price and resend with the SAME nonce to replace the stuck transaction.
//
// Detection primarily uses the ethers error code, which ethers sets for this
// condition regardless of the underlying node's wording (e.g. ethers'
// "replacement fee too low" and geth/Bor's "replacement transaction
// underpriced" both surface as code REPLACEMENT_UNDERPRICED). This is the path
// taken in production. As a fallback we also match the canonical lowercase
// messages for nodes/providers that do not set the code.
//
// We deliberately do NOT match case-insensitively. These messages frequently
// also mention the nonce, and some providers (notably Hardhat) emit a
// capitalized, generic "Replacement transaction underpriced ..." message
// WITHOUT setting the ethers code. Broad case-insensitive matching would pull
// such generic errors -- and genuine nonce-collision errors -- into this
// gas-price-bump path, disrupting the nonce-based coordination between
// concurrent same-account sends (which is resolved on the nonce path by moving
// to the freed nonce). Production correctness relies on the ethers code; the
// bump/replace logic is covered by deterministic unit tests. Exported for unit
// testing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isReplacementUnderpricedError(error: any): boolean {
  if (error?.code === "REPLACEMENT_UNDERPRICED") {
    return true;
  }
  if (typeof error.message !== "string") {
    return false;
  }
  return (
    error.message.includes("replacement transaction underpriced") ||
    error.message.includes("replacement fee too low") ||
    error.message.includes("replacement underpriced")
  );
}

// Check if the error is a low gas error.
// We classify errors in the catch block by parsing their messages, matching
// case-insensitively. Exported for unit testing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isGasError(error: any): boolean {
  return (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("gas")
  );
}

async function increaseGasLimit(
  tx: TransactionRequest,
  signer: Signer,
): Promise<void> {
  if (!tx.gasLimit) {
    throw new Error("increaseGasLimit(): gasLimit undefined");
  }
  tx.gasLimit = BigInt(tx.gasLimit.toString()) * BigInt(2);

  // Get the current block number.
  if (signer === null) {
    throw new Error("increaseGasLimit(): signer undefined");
  }
  if (signer.provider === null) {
    throw new Error("increaseGasLimit(): signer.provider undefined");
  }
  const currentBlock = await signer.provider.getBlock("latest");
  if (currentBlock === null) {
    throw new Error("increaseGasLimit(): currentBlock undefined");
  }
  const currentBlockNumber = currentBlock.number;

  // Update blockGasLimit if the block has changed.
  if (
    increaseGasLimit.blockGasLimit === null ||
    increaseGasLimit.lastBlockNumber !== currentBlockNumber
  ) {
    increaseGasLimit.blockGasLimit = currentBlock.gasLimit;
    increaseGasLimit.lastBlockNumber = currentBlockNumber;
  }

  // Cap the gasLimit at the block gas limit.
  if (tx.gasLimit > increaseGasLimit.blockGasLimit) {
    tx.gasLimit = increaseGasLimit.blockGasLimit;
  }
}

// Attach static variables to the function for caching via a property.
// Static variable to store the block gas limit.
increaseGasLimit.blockGasLimit = null as bigint | null;
increaseGasLimit.lastBlockNumber = null as number | null;

// Exported for unit testing.
export async function sendTxAndWaitForHash(
  signer: Signer,
  tx: TransactionRequest,
  initialSend: boolean,
  logger: pino.Logger,
): Promise<string> {
  logger.debug("> sendTxAndWaitForHash()");
  let attempt = 0;
  // Counts consecutive "replacement underpriced" errors seen on the initial
  // send while the confirmed nonce stays UNCHANGED. Used to distinguish a
  // genuinely stuck same-nonce tx (nonce frozen across several checks) from a
  // healthy, merely pending tx (the nonce advances as it mines). Reset whenever
  // the nonce advances. See nStuckTxConfirmations for the rationale.
  let stuckNonceChecks = 0;

  verifyTx(signer, tx);

  // Retry on errors.
  // The post-increment runs the body for attempt = 1..nSendTxRetries,
  // i.e. exactly nSendTxRetries attempts.
  while (attempt++ < txSettings.nSendTxRetries) {
    try {
      logger.info(
        `sendTxAndWaitForHash(): attempt = ${attempt} of ${txSettings.nSendTxRetries}`,
      );
      logger.info(
        `sendTxAndWaitForHash(): tx = ${JSON.stringify(serializeBigInts(tx))}`,
      );
      const txResponse = await signer.sendTransaction(tx);
      logger.info(
        `sendTxAndWaitForHash(): txResponse = ${JSON.stringify(txResponse)}`,
      );
      logger.debug("< sendTxAndWaitForHash()");
      return txResponse.hash;
      // We will process specific errors in the catch block by parsing their messages.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error(`sendTxAndWaitForHash(): error = ${error}`);
      // Handle "replacement underpriced" first, before the nonce check, since
      // these messages often also mention the nonce and would otherwise be
      // misrouted to the nonce path.
      //
      // A transaction with this nonce is already in the node's mempool. On the
      // initial send this has three possible causes, and we must NOT evict a
      // healthy transaction, so we disambiguate by refetching the chain nonce:
      //   1. A concurrent send from this account claimed this nonce and is
      //      healthy/pending. As it (and prior txs) confirm, the refetched
      //      confirmed nonce advances. Remedy: move to the new nonce WITHOUT
      //      bumping the fee, to avoid a replacement-fee war between our own
      //      concurrent transactions.
      //   2. A merely pending tx (a sibling, or our own from a prior call) holds
      //      this nonce but has not mined yet. The confirmed nonce is unchanged,
      //      but the tx is healthy and will mine shortly. We must NOT replace it.
      //   3. Our own prior tx is genuinely stuck at this nonce. The confirmed
      //      nonce never advances (nothing consumes it). Remedy: bump the fee
      //      above the stuck tx (by the node's price bump: Bor default 10%, on
      //      both maxFeePerGas and maxPriorityFeePerGas) and resend with the
      //      SAME nonce to replace it.
      //
      // getTransactionCount() returns the CONFIRMED nonce, so an unchanged nonce
      // cannot by itself tell cases 2 and 3 apart -- both leave it frozen for
      // now. We therefore only treat the tx as stuck (case 3) after the nonce
      // stays frozen across nStuckTxConfirmations checks: long enough that a
      // healthy pending tx (case 2) would have mined and advanced the nonce,
      // letting us move on without evicting it. NOTE: with truly concurrent
      // sends from the same account this remains a heuristic; the robust fix is
      // a single globally synchronized nonce counter (see getNonce()).
      //
      // For the genuine stuck case we must be able to climb ABOVE the stuck tx's
      // fee. That stuck tx may itself have been escalated to a high fee by a
      // prior escalatedSendTransaction() call, so a fresh climb starting from
      // the market-based initial fee could otherwise exhaust the retry budget
      // before overtaking it. We therefore do not count a productive fee bump
      // (one that actually raised the fee, i.e. we are still below the
      // maxGasPrice cap) against the retry budget: the climb continues until the
      // replacement is accepted or we reach the safety cap (which the stuck tx
      // also could not exceed). We wait briefly between bumps so the climb does
      // not hammer the node in a tight loop.
      if (isReplacementUnderpricedError(error)) {
        if (initialSend) {
          const previousNonce = tx.nonce;
          tx.nonce = await getNonce(signer);
          if (tx.nonce !== previousNonce) {
            // Case 1: the tx holding this nonce confirmed and the nonce
            // advanced. Move to the new nonce without bumping, after waiting for
            // sibling txs to make progress. Reset the stuck detector.
            stuckNonceChecks = 0;
            await waitForSendTxRetry(attempt, logger);
            logger.info(
              "sendTxAndWaitForHash(): replacement underpriced; nonce " +
                `advanced, retrying with nonce = ${tx.nonce}`,
            );
            continue;
          }
          // Nonce unchanged: could be a healthy pending tx (case 2) or a
          // genuinely stuck tx (case 3). Wait and re-check before replacing, so
          // a healthy pending tx has time to mine and we do not evict it.
          if (++stuckNonceChecks < txSettings.nStuckTxConfirmations) {
            await waitForSendTxRetry(attempt, logger);
            logger.info(
              "sendTxAndWaitForHash(): replacement underpriced; nonce " +
                `unchanged (${stuckNonceChecks}/${txSettings.nStuckTxConfirmations}), ` +
                "waiting to confirm the tx is stuck before replacing it",
            );
            continue;
          }
          // Nonce frozen across nStuckTxConfirmations checks: treat as stuck
          // (case 3) and fall through to replace it by bumping the fee.
        }
        // Genuine stuck tx (initial send) or a deliberate replacement of our own
        // in-flight tx (escalated send): bump the fee to climb above it.
        const gasPriceBeforeBump = BigInt(tx.gasPrice!.toString());
        increaseGasPrice(tx, txSettings.gasPriceEscalationFactor);
        if (BigInt(tx.gasPrice!.toString()) > gasPriceBeforeBump) {
          // Productive bump (still below the safety cap): do not let the climb
          // be cut short by the retry budget. Once the fee reaches the cap the
          // bump is no longer productive and the budget applies as usual.
          attempt--;
          // Brief, non-growing wait so the climb does not hammer the node.
          await waitForSendTxRetry(1, logger);
        }
        logger.info(
          "sendTxAndWaitForHash(): replacement underpriced; bumping gasPrice " +
            `= ${tx.gasPrice} to replace stuck tx at nonce = ${tx.nonce}`,
        );
        continue;
      }
      // Check and handle nonce errors before gas errors
      // since these are due to races with other txs and take the longest to handle.
      if (isNonceError(error)) {
        if (initialSend) {
          // If the error complains about nonce, attempt to update nonce.
          // This will handle cases where a prior tx has failed
          // and the client is confused about the nonce.
          // We only update the nonce on the initial send.
          // Any subsequent escalated sends will use the same nonce
          // to speed up the previously submitted tx.
          // If we update the nonce on escalated sends, we will
          // be submitting new transactions instead of speeding up the old ones.
          // Note that we need to update the nonce in the tx object
          // such that it is updated for the caller.
          // We need to wait before retrying to ensure the prior tx(s) completed.
          // We need to wait before getting a new nonce and retrying to use the latest nonce.
          await waitForSendTxRetry(attempt, logger);
          tx.nonce = await getNonce(signer);
          logger.info(
            `sendTxAndWaitForHash(): Retrying with nonce = ${tx.nonce}`,
          );
          continue;
        } else {
          // If the error complains about nonce on escalated sends,
          // our prior tx must have completed and updated the nonce.
          // Rethrow the error so that the upper layers can
          // check for tx completion for the prior txs.
          throw error;
        }
      }
      if (isGasError(error)) {
        // If the error complains about gas, increase the gas limit and retry.
        // We do not need to wait before retrying since only the gas limit is updated
        // and there is no evidence we are racing with other txs.
        await increaseGasLimit(tx, signer);
        logger.info(
          `sendTxAndWaitForHash(): Retrying with increased gasLimit = ${tx.gasLimit}`,
        );
        continue;
      }
    }
  }

  const error_msg = `sendTxAndWaitForHash(): Failed to send transaction after ${txSettings.nSendTxRetries} retries`;
  logger.error(error_msg);
  throw new Error(error_msg);
}

async function sendAndSaveTxHash(
  signer: Signer,
  tx: TransactionRequest,
  txHashes: string[],
  initialSend: boolean,
  logger: pino.Logger,
): Promise<void> {
  logger.debug("> sendAndSaveTxHash()");
  let txHash: string;
  try {
    txHash = await sendTxAndWaitForHash(signer, tx, initialSend, logger);
    logger.debug(`sendAndSaveTxHash(): txHash = ${txHash}`);
    txHashes.push(txHash);
  } catch (error) {
    logger.error(
      `sendAndSaveTxHash(): sendTxAndWaitForHash(): error = ${error}`,
    );
    throw error;
  }
  logger.debug(`< sendAndSaveTxHash(): txHashes = ${txHashes}`);
}

function estimateGasLimit(data: string, logger: pino.Logger): number {
  // Estimate gas using a profiled model for gas use.
  // CommitmentService.gas.ts estimates the following gas use
  // as a function of data.length.
  // gas = 150,000 + 400 * max(0, data.length - 778)
  // The reason for this structure is as follows:
  // The fixed cost of a commitment for a setObject with ~778 char len data is ~100K gas.
  // The slope of gas cost function is ~366gas/char of data.length.
  // This code is sensitive and should be modified only after careful testing and profiling of gas use.
  const gasLimit =
    (150000 + 400 * Math.max(0, data.length - 778)) * txSettings.gasFactor;
  logger.debug(`estimateGasLimit(): gasLimit = ${gasLimit}`);
  return gasLimit;
}

// The precision for multiplying BigInt by a float.
const BIG_INT_FLOAT_MUL_PRECISION = 1000;

function mulGasPriceByFactor(gasPrice: bigint, factor: number): bigint {
  // Use fixed point arithmetic to multiply BigInt by a float.
  return (
    (gasPrice * BigInt(Math.round(factor * BIG_INT_FLOAT_MUL_PRECISION))) /
    BigInt(BIG_INT_FLOAT_MUL_PRECISION)
  );
}

// Clamp a gas price to the configured safety backstop.
// This bounds runaway escalation (e.g. caused by a misbehaving node) without
// interfering with normal operation, since maxGasPrice sits far above any
// realistic market gas price. Exported for unit testing.
export function capGasPrice(gasPrice: bigint): bigint {
  const maxGasPrice = BigInt(txSettings.maxGasPrice);
  return gasPrice > maxGasPrice ? maxGasPrice : gasPrice;
}

// Multiply the tx gas price by a factor, clamped to the safety backstop.
// Mutates the tx in place so the updated gas price is visible to the caller and
// carried into any subsequent escalation.
function increaseGasPrice(tx: TransactionRequest, factor: number): void {
  if (tx.gasPrice === undefined || tx.gasPrice === null) {
    throw new Error("increaseGasPrice(): gasPrice undefined");
  }
  tx.gasPrice = capGasPrice(
    mulGasPriceByFactor(BigInt(tx.gasPrice.toString()), factor),
  );
}

// Determine whether a transaction receipt indicates success.
// web3 represents the status as a bigint (1n = success, 0n = revert), though
// other providers may use a number, hex string, or decimal string; normalize
// before comparing. This MUST run on the raw (non-serialized) receipt:
// serializeBigInts() turns 0n into the string "0n", which is truthy and would
// otherwise cause reverted transactions to be treated as successful.
// Exported for unit testing.
export function isReceiptSuccessful(receipt: TransactionReceipt): boolean {
  const status = receipt.status;
  return status === 1 || status === 1n || status === "0x1" || status === "1";
}

// Determine whether a transaction receipt indicates an on-chain revert.
// A receipt only exists once the tx is mined, so an explicit failure status
// means the tx was mined and reverted. We match only explicit failure values
// (not merely "not successful") so an unexpected/missing status is treated as
// "unknown" rather than as a revert. Must run on the raw (non-serialized)
// receipt for the same reason as isReceiptSuccessful(). Exported for testing.
export function isReceiptReverted(receipt: TransactionReceipt): boolean {
  const status = receipt.status;
  return status === 0 || status === 0n || status === "0x0" || status === "0";
}

// Exported for unit testing.
export async function getCompletedTxReceipt(
  web3: Web3,
  txHashes: string[],
  logger: pino.Logger,
): Promise<TransactionReceipt | null> {
  logger.debug("> getCompletedTxReceipt()");
  logger.debug(`getCompletedTxReceipt(): txHashes = ${txHashes}`);

  const n_txs = txHashes.length;
  for (let i = 0; i < n_txs; i++) {
    logger.debug(`getCompletedTxReceipt(): tx ${i + 1} of ${n_txs}`);
    const txHash = txHashes[i];
    logger.debug(`getCompletedTxReceipt(): txHash = ${txHash}`);

    // Check if any of the previously sent transactions has been confirmed.
    // Keep the raw receipt so we can evaluate its status correctly; serialize
    // only for logging and for the returned value.
    let receipt: null | TransactionReceipt = null;
    try {
      receipt = await web3.eth.getTransactionReceipt(txHash);
    } catch (error) {
      logger.error(
        `getCompletedTxReceipt(): getTransactionReceipt(): error = ${JSON.stringify(error)}`,
      );
    }
    logger.debug(
      `getCompletedTxReceipt(): receipt = ${JSON.stringify(serializeBigInts(receipt))}`,
    );
    if (receipt && isReceiptSuccessful(receipt)) {
      // Transaction is confirmed and successful, return the receipt.
      const serializedReceipt = serializeBigInts(receipt);
      logger.debug(
        `< getCompletedTxReceipt(): receipt = ${JSON.stringify(serializedReceipt)}`,
      );
      return serializedReceipt;
    }
    if (receipt && isReceiptReverted(receipt)) {
      // The transaction was mined but reverted. This is terminal: a reverted tx
      // consumes its nonce, so no same-nonce replacement can ever succeed, and
      // escalating/polling further would only end in a generic timeout. Fail
      // fast with a clear, actionable error instead. (At most one tx per nonce
      // can be mined, so a reverted tracked tx is the definitive outcome.)
      const error_msg =
        "getCompletedTxReceipt(): transaction reverted on-chain " +
        `(status = ${receipt.status}): txHash = ${txHash}`;
      logger.error(error_msg);
      throw new Error(error_msg);
    }
  }

  logger.debug("< getCompletedTxReceipt(): receipt = null");
  return null;
}

async function waitForTxCompletionCheck(
  numGasPriceEscalations: number,
): Promise<void> {
  // Increase the interval between checks to back off on heavy load.
  const txCompletionCheckTimeout =
    numGasPriceEscalations * txSettings.txCompletionCheckInterval +
    Math.random() * txSettings.txCompletionCheckRndInterval;
  await new Promise((resolve) => setTimeout(resolve, txCompletionCheckTimeout));
  return;
}

/**
 * Sends an Ethereum transaction with escalation logic to increase gas price if needed.
 *
 * @param {Web3} web3 - The Web3 instance used for interacting with the blockchain.
 * @param {Signer} signer - The Ethereum signer responsible for signing the transaction.
 * @param {string} to - The recipient Ethereum address.
 * @param {string} data - The encoded transaction data.
 * @param {pino.Logger} logger - The logger instance for debugging and error tracking.
 * @param {number} [gasLimit] - Optional gas limit for the transaction.
 *
 * @returns {Promise<string>} - A promise that resolves to the transaction hash.
 *
 * @throws {Error} If the transaction fails to send or encounters an error.
 */
export async function escalatedSendTransaction(
  web3: Web3,
  signer: Signer,
  to: string,
  data: string,
  logger: pino.Logger,
  gasLimit?: number,
): Promise<TransactionReceipt> {
  logger.debug("> escalatedSendTransaction()");
  logger.debug(
    `escalatedSendTransaction(): txSettings = ${JSON.stringify(txSettings)}`,
  );

  if (gasLimit === undefined) {
    gasLimit = estimateGasLimit(data, logger);
  }

  // Calculate an aggressive gas price premium for the initial tx.
  const currentGasPrice = await web3.eth.getGasPrice();
  logger.debug(
    `escalatedSendTransaction(): currentGasPrice = ${currentGasPrice}`,
  );
  // Add the initial factor to the current gas price, clamped to the backstop.
  const gasPrice = capGasPrice(
    mulGasPriceByFactor(currentGasPrice, txSettings.gasPriceInitialFactor),
  );
  logger.debug(`escalatedSendTransaction(): Initial gasPrice = ${gasPrice}`);

  // Define the nonce we will use for the initial tx and any replacements.
  // TODO: Eventually, read the nonce from a synchronized global counter atomically.
  // The current code has a race condition where two transactions
  // could get the same nonce and one of them will fail with nonce too low.
  // We address this by updating nonce on failure and retrying,
  // but this is inefficient and could be avoided with a global counter.
  const nonce = await getNonce(signer);
  logger.debug(`escalatedSendTransaction(): nonce = ${nonce}`);

  const tx = {
    to: to,
    data: data,
    gasLimit: gasLimit,
    gasPrice: gasPrice,
    nonce: nonce,
  };
  logger.debug(
    `escalatedSendTransaction(): tx = ${JSON.stringify(serializeBigInts(tx))}`,
  );

  // We must keep all sent txs in a list since any of the previously sent
  // txs may get confirmed when escalating or resending any of the txs.
  // Initialize an array to store all transaction hashes.
  const txHashes: string[] = [];

  // Send the initial tx.
  // Note that the initial tx may have its nonce updated
  // if a prior tx has completed and updated the nonce.
  await sendAndSaveTxHash(signer, tx, txHashes, true, logger);
  logger.debug(
    `escalatedSendTransaction(): After sendAndSaveTxHash() tx = ${JSON.stringify(serializeBigInts(tx))}`,
  );

  // The timeout after which, if the tx has not completed,
  // we will escalate the gas price.
  let gasPriceEscalationTimeout = txSettings.gasPriceEscalationInterval;
  // The time after which, if the tx has not completed,
  // we will escalate the gas price.
  let nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;
  let numGasPriceEscalations = 0;

  // If the tx does not complete, escalate the gas price and resend.
  // The post-increment runs the body for numGasPriceEscalations =
  // 1..maxGasPriceEscalations, i.e. exactly maxGasPriceEscalations attempts.
  while (numGasPriceEscalations++ < txSettings.maxGasPriceEscalations) {
    await waitForTxCompletionCheck(numGasPriceEscalations);

    // Check the status of all transactions.
    // getCompletedTxReceipt() returns a receipt only for a successful tx.
    const receipt = await getCompletedTxReceipt(web3, txHashes, logger);
    if (receipt) {
      // Transaction is confirmed, return the receipt.
      logger.info(
        `escalatedSendTransaction(): Tx confirmed for numGasPriceEscalations = ${numGasPriceEscalations}`,
      );
      logger.debug("< escalatedSendTransaction()");
      return receipt;
    }

    // If we are past tx escalation timeout,
    // increase the gas price and resend.
    if (Date.now() > nextGasPriceEscalationTime) {
      // Record escalation and set the next escalation time.
      logger.info(
        `escalatedSendTransaction(): numGasPriceEscalations = ${numGasPriceEscalations} ` +
          `of ${txSettings.maxGasPriceEscalations}`,
      );

      // Increase the interval between escalations to back off on heavy load.
      gasPriceEscalationTimeout += txSettings.gasPriceEscalationInterval;
      nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;

      // Escalate the gas price, clamped to the backstop.
      increaseGasPrice(tx, txSettings.gasPriceEscalationFactor);
      logger.info(
        `escalatedSendTransaction(): Escalated tx.gasPrice = ${tx.gasPrice}`,
      );
      logger.debug(
        `escalatedSendTransaction(): tx = ${JSON.stringify(serializeBigInts(tx))}`,
      );

      // Send the escalated tx.
      // The tx will be submitted with the initial or updated nonce.
      try {
        await sendAndSaveTxHash(signer, tx, txHashes, false, logger);
      } catch (error) {
        logger.error(
          `escalatedSendTransaction(): sendAndSaveTxHash(): error = ${error}`,
        );
        // If the escalated tx fails with a nonce error,
        // it means the prior tx has completed and updated the nonce.
        // Check for the completion of the prior txs.
        if (isNonceError(error)) {
          // Check if a prior tx has completed.
          // getCompletedTxReceipt() returns a receipt only for a successful tx.
          const receipt = await getCompletedTxReceipt(web3, txHashes, logger);
          if (receipt) {
            // Prior txs have completed, return the receipt.
            logger.info(
              `escalatedSendTransaction(): Tx confirmed for numGasPriceEscalations = ${numGasPriceEscalations}`,
            );
            logger.debug("< escalatedSendTransaction()");
            return receipt;
          }
          // If we did not find a completed tx, the node may not have yet learned of its completion.
          // Keep trying and see if we pick up the completion on the next iteration.
        }

        // There is no defined way to handle other unhandled errors.
        // Try a few more times to re-submit the transaction.
      }
    }
  }

  const error_msg = `Transaction was not confirmed after ${txSettings.maxGasPriceEscalations} attempts.`;
  logger.error(error_msg);
  throw new Error(error_msg);
}
