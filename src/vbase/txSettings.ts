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
  maxGasPriceEscalations: settingsEnv.maxGasPriceEscalations || 10,

  /**
   * Interval for checking whether a transaction has been completed (in milliseconds).
   *
   * @default 1000 (1 second)
   */
  txCompletionCheckInterval: settingsEnv.txCompletionCheckInterval || 1000,

  /**
   * Random interval for checking whether a transaction has been completed (in milliseconds).
   * We add a random delay to reduce collisions with other transactions.
   *
   * @default 1000 (1 second)
   */
  txCompletionCheckRndInterval:
    settingsEnv.txCompletionCheckRndInterval || 1000,

  /**
   * Maximum number of retries when attempting to send a transaction.
   *
   * @default 5
   */
  nSendTxRetries: settingsEnv.nSendTxRetries || 10,

  /**
   * Interval for retrying to send a transaction (in milliseconds).
   *
   * @default 1000 (1 second)
   */
  waitForSendTxRetryInterval: settingsEnv.waitForSendTxRetryInterval || 1000,

  /**
   * Number of consecutive "replacement underpriced" observations with an
   * UNCHANGED confirmed nonce that the initial send must see before it treats a
   * same-nonce transaction as genuinely stuck and replaces it by bumping the
   * fee.
   *
   * getTransactionCount() returns the last CONFIRMED nonce, so an unchanged
   * nonce only proves "nothing mined yet" -- it does NOT prove that the
   * same-nonce transaction is ours and stuck. It could be a healthy, merely
   * pending transaction (a concurrent send from this account, or our own from a
   * prior call) that simply has not mined yet. Bumping the fee and resending
   * different data at that nonce would evict such a healthy transaction.
   *
   * To avoid that, the initial send waits and re-checks the nonce this many
   * times before replacing. A healthy pending transaction will mine within a
   * block or two (advancing the nonce, which makes us move on without a bump),
   * whereas a genuinely stuck transaction keeps the nonce frozen. The default,
   * combined with the growing waitForSendTxRetry backoff, spans several block
   * times on fast chains, which is enough to distinguish the two. Raise it on
   * chains with long or highly variable block times, or when many concurrent
   * sends from the same account are expected.
   *
   * @default 5
   */
  nStuckTxConfirmations: settingsEnv.nStuckTxConfirmations || 5,

  /**
   * Absolute upper bound on the gas price (in wei) that any single transaction
   * may be escalated to. This is a safety backstop: it sits well above realistic
   * market gas prices (including extreme congestion spikes) so that it does not
   * interfere with normal escalation, while bounding both runaway escalation
   * caused by a misbehaving node (e.g. one that repeatedly forces fee bumps via
   * "replacement underpriced") AND the worst-case spend per transaction.
   *
   * Worst-case spend per accepted tx is approximately maxGasPrice * gasLimit.
   * At the default (10,000 gwei) and a 3,000,000 gas limit this is 3e19 wei
   * (~30 native tokens), versus ~3,000 at the old 1e15 backstop. Raise it for
   * chains/conditions with higher legitimate fees.
   *
   * Note: once the gas price is clamped at this cap, further fee bumps can no
   * longer satisfy a node's replacement price bump, so a replacement may stop
   * progressing. This is acceptable because the cap sits well above normal fees.
   *
   * @default 1e13 (10,000 gwei)
   */
  maxGasPrice: settingsEnv.maxGasPrice || 1e13,
};

export default txSettings;
