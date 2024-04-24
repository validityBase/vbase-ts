# vbase-ts

vBase TypeScript Software Development Kit (SDK)

---

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Introduction

vBase creates a global auditable record of when data was created, by whom, and how it has changed (collectively, “data provenance”). Data producers can prove the provenance of their data to any external party, increasing its value and marketability. Data consumers can ensure the integrity of historical data and any derivative calculations. The result is trustworthy information that can be put into production quickly without expensive and time-consuming trials.

Verifiable provenance establishes the credibility of data and calculations. For example, if you wish to prove investment skill, the recipient must be sure they are receiving a complete and accurate record of your timestamped trades or portfolios.

vBase resolves several expensive market failures common to financial data. Some of the areas that benefit include:
- Provably point-in-time datasets
- Auditable investing track records
- Sound backtests, historical simulations, and time-series modeling

vBase services do not require access to the data itself, assuring privacy. They also do not rely on centralized intermediaries, eliminating the technical, operating, and business risks of a trusted party controlling your data and its validation. vBase ensures data security and interoperability that is unattainable with legacy centralized systems. It does so by storing digital fingerprints of data, metadata, and revisions on secure public blockchains.

With vBase, creating and consuming provably correct data is as easy as pressing a button.

## Setup

1. Change to the working directory:
    ```shell
    cd ~/validityBase/vbase-ts
    ```

1. Copy CommitmentService ABIs:
    ```shell
    cp ~/validityBase/commitment-service-core/artifacts/contracts/CommitmentService.sol/CommitmentService.json src/common/contracts &&
    cp ~/validityBase/commitment-service-core/artifacts/contracts/test/CommitmentServiceTest.sol/CommitmentServiceTest.json src/common/contracts
    ```

## Tests

1. Change to the working directory:
    ```shell
    cd ~/validityBase/vbase-ts
    ```

1. Run localhost tests:
    ```shell
    hh test --network localhost
    ```

1. Format:
    ```shell
    npm run prettier:ts &&
    npm run prettier:ts src &&
    npm run prettier:ts test
    ```

1. Lint:
    ```shell
    npm run lint &&
    npm run lint src &&
    npm run lint test
    ```

## Misc
```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```
