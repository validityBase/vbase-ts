import dotenv from "dotenv";

dotenv.config();

// To set multiple values using a single environment variable we use a JSON string.
// This allows us to define complex configurations in a structured manner.
// This also ensures that settings for a given chain are used jointly and consistently.
const settingsEnv = JSON.parse(process.env.VBASE_TS_TX_SETTINGS || "{}");

/**
 * Configuration settings for transaction gas, timeout, and escalation behavior.
 * These settings are designed to work conservatively across multiple EVM chains,
 * with default values ensuring robust execution. Chains with shorter block times
 * or different gas dynamics can override these for better optimization.
 */
const txSettings = {
  /**
   * Gas limit factor: A multiplier applied to the estimated gas limit.
   * Set to a high value for L2s that require accounting for L1 gas charges.
   *
   * @default 20
   */
  gasFactor: settingsEnv.gasFactor || 20,

  /**
   * Initial gas price multiplier: Applies a premium to the estimated gas price
   * to improve transaction execution speed.
   *
   * @default 1.5
   */
  gasPriceInitialFactor: settingsEnv.gasPriceInitialFactor || 1.5,

  /**
   * Gas price escalation factor: The multiplier for increasing the gas price
   * if the transaction remains unconfirmed.
   *
   * @default 2
   */
  gasPriceEscalationFactor: settingsEnv.gasPriceEscalationFactor || 2,

  /**
   * Gas price escalation interval in milliseconds: Defines how frequently
   * the gas price should be escalated for unconfirmed transactions.
   *
   * This default is suited for Ethereum mainnet but can be lowered for faster chains.
   *
   * @default 10000 (10 seconds)
   */
  gasPriceEscalationInterval: settingsEnv.gasPriceEscalationInterval || 10000,

  /**
   * Maximum number of gas price escalations before giving up.
   *
   * @default 5
   */
  maxGasPriceEscalations: settingsEnv.maxGasPriceEscalations || 5,

  /**
   * Interval for checking whether a transaction has been completed (in milliseconds).
   *
   * @default 1000 (1 second)
   */
  txCompletionCheckInterval: settingsEnv.txCompletionCheckInterval || 1000,

  /**
   * Maximum number of retries when attempting to send a transaction.
   *
   * @default 5
   */
  nSendTxRetries: settingsEnv.nSendTxRetries || 5,
};

export default txSettings;
