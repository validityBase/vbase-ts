import { ethers, TransactionRequest } from "ethers";
import { pino } from "pino";
import { Web3 } from "web3";
import { TransactionReceipt } from "web3-types";

import { TransactionSettings } from "./transactionSettings";

// This is a general function operating on a variety of objects.
// Disable warning for obj: any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBigInts(obj: any): any {
  // If the object is a bigint, return its string representation.
  if (typeof obj === "bigint") {
    return obj.toString() + "n";
  }

  // If the object is an array, recursively process each element.
  if (Array.isArray(obj)) {
    return obj.map((value) => serializeBigInts(value));
  }

  // If the object is a plain object, recursively process each key-value pair.
  if (typeof obj === "object" && obj !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = serializeBigInts(obj[key]);
      }
    }
    return result;
  }

  // If the object is neither a bigint, an array, nor a plain object, return it as is.
  return obj;
}

// This is a general function operating on a variety of objects.
// Disable warning for obj: any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonPrettyStringify(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

async function sendTxAndWaitForHash(
  ethersWallet: ethers.Wallet,
  tx: TransactionRequest,
  logger: pino.Logger,
): Promise<string> {
  try {
    logger.info(
      `sendTxAndWaitForHash(): tx = ${jsonPrettyStringify(
        serializeBigInts(tx),
      )}`,
    );
    const txResponse = await ethersWallet.sendTransaction(tx);
    logger.info(
      `sendTxAndWaitForHash(): txResponse = ${jsonPrettyStringify(txResponse)}`,
    );
    return txResponse.hash;
  } catch (error) {
    logger.error(
      `sendTxAndWaitForHash(): error = ${jsonPrettyStringify(error)}`,
    );
    throw error;
  }
}

export async function escalatedSendTransaction(
  web3: Web3,
  ethersWallet: ethers.Wallet,
  to: string,
  data: string,
  logger: pino.Logger,
): Promise<TransactionReceipt> {
  logger.debug("> escalatedSendTransaction()");

  // Auto-gas estimation does not work correctly on some chains.
  // Polygon sets it to 550mil by default, even for read-only eth_call, for instance, to avoid DOS.
  const gasLimit =
    Number(
      await web3.eth.estimateGas({
        to: to,
        data: data,
      }),
    ) * TransactionSettings.GAS_FACTOR;
  logger.debug(`escalatedSendTransaction(): gasLimit = ${gasLimit}`);

  // Calculate an aggressive gas price premium for the initial tx.
  const currentGasPrice = await web3.eth.getGasPrice();
  logger.debug(
    `escalatedSendTransaction(): currentGasPrice = ${currentGasPrice}`,
  );

  // Use fixed point arithmetic to multiply BigInt by a float.
  const gasPrice =
    (currentGasPrice *
      BigInt(Math.round(TransactionSettings.GAS_PRICE_INITIAL_FACTOR * 100))) /
    BigInt(100);
  logger.debug(`escalatedSendTransaction(): Initial gasPrice = ${gasPrice}`);

  // Define the nonce we will use for the initial tx and any replacements.
  const nonce = await ethersWallet.getNonce();
  logger.debug(`escalatedSendTransaction(): nonce = ${nonce}`);

  const tx = {
    to: to,
    data: data,
    gasLimit: gasLimit,
    gasPrice: gasPrice,
    nonce: nonce,
  };
  logger.debug(
    `escalatedSendTransaction(): tx = ${jsonPrettyStringify(serializeBigInts(tx))}`,
  );

  // Send the initial tx.
  // The initial send should not fail.
  // If we encounter its failures in normal operation, we should add retries.
  // TODO: Add retries.
  let txHash: string;
  try {
    txHash = await sendTxAndWaitForHash(ethersWallet, tx, logger);
  } catch (error) {
    logger.error(
      `escalatedSendTransaction(): sendTxAndWaitForHash(): error = ${jsonPrettyStringify(
        error,
      )}`,
    );
    // TODO: Retry instead of throwing.
    throw error;
  }
  logger.debug(`escalatedSendTransaction(): Initial txHash = ${txHash}`);
  // We must keep all sent txs in a list since any of the previously sent
  // txs may get confirmed when escalating.
  // TODO: Add tx list.

  // The timeout after which, if the tx has not completed,
  // we will escalate the gas price.
  let gasPriceEscalationTimeout =
    TransactionSettings.GAS_PRICE_ESCALATION_INTERVAL;
  // The time after which, if the tx has not completed,
  // we will escalate the gas price.
  let nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;
  let numGasPriceEscalations = 0;
  // The interval for polling for tx completion.
  let txCompletionCheckTimeout = 0;
  while (
    numGasPriceEscalations < TransactionSettings.MAX_GAS_PRICE_ESCALATIONS
  ) {
    // Wait for the interval before checking transaction status.
    // Increase the interval between checks to back off on heavy load.
    txCompletionCheckTimeout +=
      TransactionSettings.TX_COMPLETION_CHECK_INTERVAL;
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
        `escalatedSendTransaction(): getTransactionReceipt(): error = ${jsonPrettyStringify(
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
      gasPriceEscalationTimeout +=
        TransactionSettings.GAS_PRICE_ESCALATION_INTERVAL;
      nextGasPriceEscalationTime = Date.now() + gasPriceEscalationTimeout;

      const currentGasPrice = BigInt(tx.gasPrice);
      tx.gasPrice =
        (currentGasPrice *
          BigInt(
            Math.round(TransactionSettings.GAS_PRICE_ESCALATION_FACTOR * 100),
          )) /
        BigInt(100);
      logger.info(
        `escalatedSendTransaction(): Escalated tx.gasPrice = ${tx.gasPrice}`,
      );
      // Ensure nonce remains the same for the replacement transaction.
      // This will speed up the previously submitted tx.
      tx.nonce = nonce;
      logger.debug(
        `escalatedSendTransaction(): tx = ${jsonPrettyStringify(serializeBigInts(tx))}`,
      );

      // Send the escalated tx.
      try {
        // This tx may fail if a prior one has finished.
        // In that case, we will check the prior tx hash and should process the completion successfully.
        txHash = await sendTxAndWaitForHash(ethersWallet, tx, logger);
      } catch (error) {
        logger.error(
          `escalatedSendTransaction(): sendTxAndWaitForHash(): error = ${jsonPrettyStringify(
            error,
          )}`,
        );
        // TODO: Retry instead of throwing.
        throw error;
      }
      logger.debug(`escalatedSendTransaction(): Escalated txHash = ${txHash}`);
    }
  }

  throw new Error(
    `Transaction was not confirmed after ${TransactionSettings.MAX_GAS_PRICE_ESCALATIONS} attempts.`,
  );
}
