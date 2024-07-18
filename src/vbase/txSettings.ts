import dotenv from "dotenv";

dotenv.config();

// To set multiple values using a single environment variable we use a JSON string.
// This allows us to define complex configurations in a structured manner.
// This also ensures that settings for a given chain are used jointly and consistently.
const settingsEnv = JSON.parse(process.env.VBASE_TS_TX_SETTINGS || "{}");

// Tx gas, timeout, and escalation settings
// These differ across different EVM chains.
// The default values are set for the most conservative values
// that are likely to work robustly across the most chains.
// Specific chains with shorter block times, etc. can override these
// to more optimal values.
const txSettings = {
  // Gas limit factor. The multiple of the estimated gas limit for the transaction.
  // Set a high limit to support L2s that must account for L1 gas charges.
  // This is a high value appropriate for L2 with L1 gas charges
  // where gas estimates are not reliable.
  gasFactor: settingsEnv.gasFactor || 20,
  // Pay an aggressive gas price premium to ensure prompt execution.
  gasPriceInitialFactor: settingsEnv.gasPriceInitialFactor || 1.5,
  // Gas price escalation factor.
  gasPriceEscalationFactor: settingsEnv.gasPriceEscalationFactor || 2,
  // Interval for escalating gas price for uncompleted transactions, in milliseconds.
  // This is a low value appropriate for slow Ethereum mainnet.
  gasPriceEscalationInterval: settingsEnv.gasPriceEscalationInterval || 10000,
  // Maximum attempts for escalating transactions.
  maxGasPriceEscalations: settingsEnv.maxGasPriceEscalations || 5,
  // Interval for checking transaction for completion, in milliseconds.
  txCompletionCheckInterval: settingsEnv.txCompletionCheckInterval || 1000,
  // Maximum number of retries for sending a transaction.
  nSendTxRetries: settingsEnv.nSendTxRetries || 5,
};

export default txSettings;
