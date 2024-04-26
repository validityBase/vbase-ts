// Tx escalation settings.
export class TransactionSettings {
  // Gas limit factor. The multiple of the estimated gas limit for the transaction.
  static GAS_FACTOR = 2;
  // Pay an aggressive gas price premium to ensure prompt execution.
  static GAS_PRICE_INITIAL_FACTOR = 1.5;
  // Gas price escalation factor.
  static GAS_PRICE_ESCALATION_FACTOR = 1.5;
  // Interval for escalating gas price for uncompleted transactions, in milliseconds.
  static GAS_PRICE_ESCALATION_INTERVAL = 5000;
  // Maximum attempts for escalating transactions.
  static MAX_GAS_PRICE_ESCALATIONS = 10;
  // Interval for checking transaction for completion, in milliseconds.
  static TX_COMPLETION_CHECK_INTERVAL = 1000;
}
