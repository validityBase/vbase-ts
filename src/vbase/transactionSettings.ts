// Tx escalation settings.
export class TransactionSettings {
    // Pay an aggressive gas price premium to ensure prompt execution.
    static GAS_PRICE_INITIAL_FACTOR: number = 1.2;
    // Gas price escalation factor.
    static GAS_PRICE_ESCALATION_FACTOR: number = 1.2;
    // Interval for escalating gas price for uncompleted transactions, in milliseconds.
    static GAS_PRICE_ESCALATION_INTERVAL: number = 5000;
    // Maximum attempts for escalating transactions.
    static MAX_GAS_PRICE_ESCALATIONS: number = 10;
    // Interval for checking transaction for completion, in milliseconds.
    static TX_COMPLETION_CHECK_INTERVAL: number = 1000;
}
