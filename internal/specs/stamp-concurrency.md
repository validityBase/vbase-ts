# VDT-898: sequential transaction submission

`escalatedSendTransaction` queues by chain ID and signer address before gas/nonce
lookup, and holds ownership through the existing send/escalation/receipt path.
Separate signer instances for the same address share one local queue. Different
addresses remain concurrent. Failures release ownership without poisoning queued
work. Account/chain lookup failures are pre-submission errors. Existing typed
unknown-outcome errors and transaction replacement policy remain unchanged.

This SDK sends chain transactions, not app REST stamp requests; Retry-After and
HTTP idempotency belong to REST callers. A signer queue protects the submitting
account, not the separately signed `forwardRequest.from` user. Coordination across
forwarder processes and app instances remains a shared server rollout prerequisite.

Run `npm test` for the native queue tests and existing Hardhat suite.

Native tests exercise the exported wrapper with distinct signer instances and
address casing, hold receipt completion, verify release after rejection, and allow
different chains/accounts to complete while another receipt is pending.

The native tests live outside Hardhat discovery so their temporary settings do
not overlap Mocha integration tests. Run them after the build with
`node --test unit-tests/UserTransactionQueue.test.mjs`.
