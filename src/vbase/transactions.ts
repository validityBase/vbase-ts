import { NonceManager, Signer, TransactionRequest } from "ethers";
import { pino } from "pino";
import { Web3 } from "web3";
import { TransactionReceipt } from "web3-types";

import txSettings from "./txSettings";
import { serializeBigInts } from "./utils";

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
// We will process specific errors in the catch block by parsing their messages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNonceError(error: any): boolean {
  return (
    typeof error.message === "string" &&
    // All error that include "nonce" in the message are nonce errors.
    (error.message.includes("nonce") ||
      // Errors that include "replacement fee too low" in the message are also nonce errors.
      // This happens when there is a nonce collision with another tx
      // and the node thinks we are submitting a replacement tx instead of a new one.
      error.message.includes("replacement fee too low"))
  );
}

// Check if the error is a low gas error.
// We will process specific errors in the catch block by parsing their messages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isGasError(error: any): boolean {
  return typeof error.message === "string" && error.message.includes("gas");
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

async function sendTxAndWaitForHash(
  signer: Signer,
  tx: TransactionRequest,
  initialSend: boolean,
  logger: pino.Logger,
): Promise<string> {
  logger.debug("> sendTxAndWaitForHash()");
  let attempt = 0;

  verifyTx(signer, tx);

  // Retry on errors.
  while (attempt++ < txSettings.nSendTxRetries - 1) {
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
      // Check and handle nonce errors first before any others
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
          // We've hit a bug where the node keeps returning the same nonce
          // even though it is stale. This shows up in the logs as follows:
          // [09:47:49.622] ERROR (29): sendTxAndWaitForHash(): error = Error: replacement fee too low
          // [09:47:49.317] INFO (29): sendTxAndWaitForHash(): attempt = 4 of 10
          // [09:47:49.317] INFO (29): sendTxAndWaitForHash(): Retrying with nonce = 25571
          // TODO: Work around the above bug by checking if tx.nonce is unchanged from the prior (failed) call.
          // If it is unchanged, we should forcebly increment the nonce.
          if (tx.nonce === (await getNonce(signer))) {
            throw new Error("sendTxAndWaitForHash(): nonce has not changed");
          }
          logger.info(
            `sendTxAndWaitForHash(): Retrying with nonce = ${tx.nonce}`,
          );
          continue;
        } else {
          // If the error complains about nonce on escalated sends,
          // out prior tx must have completed and updated the nonce.
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

  const error_msg = `sendTxAndWaitForHash(): Failed to send transaction after ${attempt} retries`;
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

async function getCompletedTxReceipt(
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
    let receipt: null | TransactionReceipt = null;
    try {
      receipt = await web3.eth.getTransactionReceipt(txHash);
      receipt = serializeBigInts(receipt);
    } catch (error) {
      logger.error(
        `getCompletedTxReceipt(): getTransactionReceipt(): error = ${JSON.stringify(error)}`,
      );
    }
    logger.debug(
      `getCompletedTxReceipt(): receipt = ${JSON.stringify(receipt)}`,
    );
    if (receipt && receipt.status) {
      // Transaction is confirmed, return the receipt.
      logger.debug(
        `< getCompletedTxReceipt(): receipt = ${JSON.stringify(receipt)}`,
      );
      return receipt;
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
  // Add the initial factor to the current gas price.
  const gasPrice = mulGasPriceByFactor(
    currentGasPrice,
    txSettings.gasPriceInitialFactor,
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
  while (numGasPriceEscalations++ < txSettings.maxGasPriceEscalations - 1) {
    await waitForTxCompletionCheck(numGasPriceEscalations);

    // Check the status of all transactions.
    const receipt = await getCompletedTxReceipt(web3, txHashes, logger);
    if (receipt && receipt.status) {
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

      // Escalate the gas price.
      tx.gasPrice = mulGasPriceByFactor(
        tx.gasPrice,
        txSettings.gasPriceEscalationFactor,
      );
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
          const receipt = await getCompletedTxReceipt(web3, txHashes, logger);
          if (receipt && receipt.status) {
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
