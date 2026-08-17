---
name: Hardhat v2→v3 migration incompatibilities and fixes
description: Root-cause analysis and fixes for test failures from the completed HH2→HH3 migration, now merged into main
type: project
---

## Context

The `dev-greg` branch carried the Hardhat 2 → Hardhat 3 migration, which is now merged into `main`.
Before the migration, `main` used `@nomicfoundation/hardhat-toolbox@5`, which bundled many plugins and exported
HRE shortcuts. That toolbox was removed entirely in v3.

Tests passed on the pre-migration `main` branch (HH2). The migration introduced the following incompatibilities.

---

## Incompatibility 1 — `hardhat-toolbox` removed; `{ ethers, network }` HRE shortcuts gone

**HH2 (pre-migration `main`):** `@nomicfoundation/hardhat-toolbox@5` bundled `hardhat-ethers`, `hardhat-chai-matchers`,
`hardhat-network-helpers`, and exposed `{ ethers, network }` as named exports from `"hardhat"`.

**HH3 (current):** `hardhat-toolbox` is gone. Individual plugins are used. The `"hardhat"` module
no longer exports `ethers` or a `NetworkConnection`-like `network`.

**Fix applied:** Removed named imports. Use `hre.network.getOrCreate()` (see #2 below).

---

## Incompatibility 2 — `hre.network.provider` and `hre.ethers` are `undefined` in HH3

**HH2:** `hre.network` was a `NetworkConnection` with `.provider` (EthereumProvider) and `.ethers`.
`hre.ethers` was also available directly.

**HH3:** `hre.network` is now a `NetworkManager` (with `.create()`, `.connect()`, `.getOrCreate()`).
It has NO `.provider`. `hre.ethers` is also `undefined`. Both `.provider` and `.ethers` live on the
`NetworkConnection` returned by `hre.network.getOrCreate()`.

**Fix applied:** In the `beforeEach`, obtain a connection first:

```typescript
network = await hre.network.getOrCreate();
// then use: network.provider.send(...), network.ethers.getSigners(), etc.
```

A module-level `let network: any;` variable holds the cached connection (getOrCreate caches it).

All usages of `hre.network.provider.send(...)` in test bodies were changed to `network.provider.send(...)`.
`hre.ethers.*` → `network.ethers.*`.

---

## Incompatibility 3 — `setNextBlockBaseFeePerGas()` direct import removed

**HH2:** `import { setNextBlockBaseFeePerGas } from "@nomicfoundation/hardhat-network-helpers"` worked.

**HH3:** `hardhat-network-helpers@3` attaches helpers to `NetworkConnection.networkHelpers`.
The direct import no longer works.

**Fix applied:** `await network.networkHelpers.setNextBlockBaseFeePerGas(newGasPrice)`.

---

## Incompatibility 4 — `chai-as-promised` never registered (`require` option ignored)

**HH2 (likely):** The `require` Mocha option worked because Mocha was run via CLI.

**HH3:** Hardhat uses Mocha programmatically (`new Mocha(config)` in `task-action.js`). The Mocha
constructor completely ignores the `require` key. The `test/setup.ts` file was never loaded.
Without `chai-as-promised`, Chai@6's Proxy throws `"Invalid Chai property: rejectedWith"` synchronously,
causing tests to fail immediately and leaving orphaned promises (producing unhandled rejections and
interleaved log output).

Additionally, Mocha's `rootHooks` API uses `beforeAll`/`afterAll`/`beforeEach`/`afterEach` (NOT `before`).
Using `before` is silently ignored.

**Fix applied:** In `hardhat.config.ts`:

```typescript
import { use } from "chai";
import chaiAsPromised from "chai-as-promised";

// in mocha config:
rootHooks: {
  beforeAll() {
    use(chaiAsPromised);
  },
},
```

Deleted `test/setup.ts` (was dead code).

---

## Incompatibility 5 — `.emit()` chai assertion unavailable in the current configuration

**HH2:** `hardhat-toolbox` bundled `@nomicfoundation/hardhat-chai-matchers@2.x` which registered
`.emit()` on chai. Tests like `expect(tx).to.emit(contract, "EventName").withArgs(...)` worked.

**HH3 + Chai@6:** The older `hardhat-chai-matchers` package is incompatible, and this
repository does not install the newer `@nomicfoundation/hardhat-ethers-chai-matchers`
package that provides HH3-compatible matchers:

- `@nomicfoundation/hardhat-chai-matchers@latest` (v3.0.0) is a stub that just prints an error
  and exits (`process.exit(1)`). It does NOT work with HH2 or HH3.
- `@nomicfoundation/hardhat-chai-matchers@hh2` (v2.1.2) requires `hardhat@^2` and `chai@^4` — incompatible.

**Fix applied:** Rewrite the `"Executes addSet"` CommitmentService test to parse the receipt logs
directly using the ethers v6 typed `EventLog` API:

```typescript
const txResponse = await commitmentService.addSet(TEST_HASH1);
const receipt = await txResponse.wait();
const addSetEvent = receipt.logs.find(
  (log): log is EventLog =>
    log instanceof EventLog && log.eventName === "AddSet",
);
expect(addSetEvent, "AddSet event not found in logs").to.not.equal(undefined);
expect(await owner.getAddress()).to.equal(addSetEvent.args[0]);
expect(TEST_HASH1).to.equal(addSetEvent.args[1]);
```

**Why:** `ContractTransactionReceipt.logs` in ethers v6 contains `EventLog | Log` objects.
When the contract ABI is known (it is, since `commitmentService` was created via `getContractFactory`),
logs from that contract are decoded as `EventLog` instances with `.eventName` and `.args`.

---

## Summary of all changes

| File                          | Change                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hardhat.config.ts`           | Switch from `HardhatUserConfig` + `hardhat-toolbox` to `defineConfig` + individual plugins; add `rootHooks.beforeAll` for `chai-as-promised`; add `type: "http"` to network configs                                                                                                                        |
| `test/Transactions.spec.ts`   | Remove `{ ethers, network }` named imports; add `let network: any`; obtain connection via `getOrCreate()` in beforeEach; update all `hre.network.provider.*`, `hre.ethers.*`, `setNextBlockBaseFeePerGas()` usages; rewrite `CommitmentService / Executes addSet` to use receipt.logs instead of `.emit()` |
| `test/Transactions.stress.ts` | Same HH3 network/ethers access pattern as spec: `network = await hre.network.getOrCreate()`, then `network.provider` / `network.ethers` (was still on HH2 `hre.network.provider` / `hre.ethers`)                                                                                                           |
| `test/setup.ts`               | Deleted (was never loaded; superseded by `rootHooks.beforeAll`)                                                                                                                                                                                                                                            |

**Why:** How to apply: whenever working on this project's test infrastructure or Hardhat config, keep in mind that the HH3 migration is complete and its patterns are NOT the same as HH2 docs show.
