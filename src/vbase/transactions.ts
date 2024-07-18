import { NonceManager, Signer, TransactionRequest } from "ethers";
import { pino } from "pino";
import { Web3 } from "web3";
import { TransactionReceipt } from "web3-types";

import txSettings from "./txSettings";
import { serializeBigInts } from "./utils";

async function sendTxAndWaitForHash(
  signer: Signer,
  tx: TransactionRequest,
  logger: pino.Logger,
): Promise<string> {
  let attempt = 0;
  const currentTx = { ...tx };

  // Ensure signer is not an instance of NonceManager.
  // NonceManager overrides nonce based on its own logic
  // and breaks nonce reset and transaction retry with higher gas limit.
  if (signer instanceof NonceManager) {
    throw new Error("sendTxAndWaitForHash(): signer is a NonceManager");
  }

  // The caller should always set the gasLimit and nonce.
  // using the heuristic in escalatedSendTransaction().
  if (!currentTx.gasLimit) {
    throw new Error("sendTxAndWaitForHash(): gasLimit undefined");
  }
  if (currentTx.nonce === undefined || currentTx.nonce === null) {
    throw new Error("sendTxAndWaitForHash(): nonce undefined");
  }

  // Retry on errors.
  while (attempt < txSettings.nSendTxRetries) {
    try {
      logger.info(
        `sendTxAndWaitForHash(): currentTx = ${JSON.stringify(serializeBigInts(currentTx))}`,
      );
      const txResponse = await signer.sendTransaction(currentTx);
      logger.info(
        `sendTxAndWaitForHash(): txResponse = ${JSON.stringify(txResponse)}`,
      );
      return txResponse.hash;
    } catch (error: any) {
      logger.error(`sendTxAndWaitForHash(): error = ${error}`);
      if (typeof error.message === "string" && error.message.includes("gas")) {
        // If the error complains about gas, double the gasLimit and retry.
        // This will handle "intrinsic gas too low" errors from L2 sequencers
        // and related errors we get when testing low gas limits on other networks.
        // We also have to advance the nonce.
        currentTx.gasLimit = (currentTx.gasLimit as number) * 2;
        attempt++;
        logger.info(
          "sendTxAndWaitForHashWithRetry(): Retrying with doubled gasLimit",
        );
        continue;
      }
      if (
        typeof error.message === "string" &&
        error.message.includes("nonce")
      ) {
        // If the error complains about nonce, attempt to update nonce.
        // This will handle cases where a prior tx has failed
        // and the client is confused about the nonce.
        // One would expect signer.getNonce() to return the correct nonce,
        // but it does not.
        // TODO: Long-term nonce management should be done via a single
        // globally synchronized counter
        // with a check on failure since the following operation is expensive.
        if (signer.provider !== null) {
          currentTx.nonce = await signer.provider.getTransactionCount(
            signer.getAddress(),
          );
        }
        attempt++;
        logger.info(
          `sendTxAndWaitForHashWithRetry(): Retrying with nonce = ${currentTx.nonce}`,
        );
        continue;
      }
    }
  }

  const error_msg = `sendTxAndWaitForHash(): Failed to send transaction after ${attempt} retries`;
  logger.error(error_msg);
  throw new Error(error_msg);
}

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

  // Estimate gas using a profiled model for gas use.
  // CommitmentService.gas.ts estimates the following gas use
  // as a function of data.length.
  // gas = 150,000 + 400 * max(0, data.length - 778)
  // The reason for this structure is as follows:
  // The fixed cost of a commitment for a setObject with ~778 char len data is ~100K gas.
  // The slope of gas cost function is ~366gas/char of data.length.
  // This code is sensitive and should be modified only after careful testing and profiling of gas use.
  if (gasLimit === undefined) {
    gasLimit =
      (150000 + 400 * Math.max(0, data.length - 778)) * txSettings.gasFactor;
  }
  logger.debug(`escalatedSendTransaction(): gasLimit = ${gasLimit}`);

  // Calculate an aggressive gas price premium for the initial tx.
  const currentGasPrice = await web3.eth.getGasPrice();
  logger.debug(
    `escalatedSendTransaction(): currentGasPrice = ${currentGasPrice}`,
  );

  // Use fixed point arithmetic to multiply BigInt by a float.
  const gasPrice =
    (currentGasPrice *
      BigInt(Math.round(txSettings.gasPriceInitialFactor * 100))) /
    BigInt(100);
  logger.debug(`escalatedSendTransaction(): Initial gasPrice = ${gasPrice}`);

  // Define the nonce we will use for the initial tx and any replacements.
  if (!signer.provider) {
    throw new Error("escalatedSendTransaction(): signer.provider undefined");
  }
  const nonce = await signer.provider.getTransactionCount(signer.getAddress());
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

  // Send the initial tx.
  // The initial send should not fail.
  // If we encounter its failures in normal operation, we should add retries.
  let txHash: string;
  try {
    txHash = await sendTxAndWaitForHash(signer, tx, logger);
  } catch (error) {
    logger.error(
      `escalatedSendTransaction(): Initial sendTxAndWaitForHash(): error = ${error}`,
    );
    throw error;
  }
  logger.debug(`escalatedSendTransaction(): Initial txHash = ${txHash}`);
  // We must keep all sent txs in a list since any of the previously sent
  // txs may get confirmed when escalating.
  // TODO: Add tx list.

  // The timeout after which, if the tx has not completed,
  // we will escalate the gas price.
  let gasPriceEscalationTimeout = txSettings.gasPriceEscalationInterval;
  // The time after which, if the tx has not completed,
  // we will escalate the gas price.
  let nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;
  let numGasPriceEscalations = 0;
  // The interval for polling for tx completion.
  let txCompletionCheckTimeout = 0;
  while (numGasPriceEscalations < txSettings.maxGasPriceEscalations) {
    // Wait for the interval before checking transaction status.
    // Increase the interval between checks to back off on heavy load.
    txCompletionCheckTimeout += txSettings.txCompletionCheckInterval;
    await new Promise((resolve) =>
      setTimeout(resolve, txCompletionCheckTimeout),
    );

    // Check if any of the previously sent transactions has been confirmed.
    let receipt: null | TransactionReceipt;
    try {
      receipt = await web3.eth.getTransactionReceipt(txHash);
      receipt = serializeBigInts(receipt);
    } catch (error) {
      logger.error(
        `escalatedSendTransaction(): getTransactionReceipt(): error = ${JSON.stringify(
          error,
        )}`,
      );
      receipt = null;
    }
    if (receipt && receipt.status) {
      // Transaction is confirmed, return the receipt.
      logger.info(
        `escalatedSendTransaction(): Tx confirmed for numGasPriceEscalations = ${numGasPriceEscalations}`,
      );
      return receipt;
    }

    // If we are past tx escalation timeout,
    // increase the gas price and resend.
    if (Date.now() > nextGasPriceEscalationTime) {
      // Record escalation and set the next escalation time.
      numGasPriceEscalations++;
      // Increase the interval between escalations to back off on heavy load.
      gasPriceEscalationTimeout += txSettings.gasPriceEscalationInterval;
      nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;

      const currentGasPrice = BigInt(tx.gasPrice);
      tx.gasPrice =
        (currentGasPrice *
          BigInt(Math.round(txSettings.gasPriceEscalationFactor * 100))) /
        BigInt(100);
      logger.info(
        `escalatedSendTransaction(): Escalated tx.gasPrice = ${tx.gasPrice}`,
      );
      // Ensure nonce remains the same for the replacement transaction.
      // This will speed up the previously submitted tx.
      tx.nonce = nonce;
      logger.debug(
        `escalatedSendTransaction(): tx = ${JSON.stringify(serializeBigInts(tx))}`,
      );

      // Send the escalated tx.
      try {
        // This tx may fail if a prior one has finished.
        // In that case, we will check the prior tx hash and should process the completion successfully.
        txHash = await sendTxAndWaitForHash(signer, tx, logger);
      } catch (error) {
        logger.error(
          `escalatedSendTransaction(): Escalated sendTxAndWaitForHash(): error = ${error}`,
        );
        throw error;
      }
      logger.debug(`escalatedSendTransaction(): Escalated txHash = ${txHash}`);
    }
  }

  const error_msg = `Transaction was not confirmed after ${txSettings.maxGasPriceEscalations} attempts.`;
  logger.error(error_msg);
  throw new Error(error_msg);
}
