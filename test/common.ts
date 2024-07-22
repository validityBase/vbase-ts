import { zeroPadBytes } from "ethers";
import { Bytes, Web3 } from "web3";
import pino from "pino";

import { abi } from "../src/common/contracts/CommitmentService.json";

export const TEST_HASH1 = zeroPadBytes("0x01", 32);
export const TEST_HASH2 = zeroPadBytes("0xff", 32);
// Use a test address that does not collide with common tests to avoid nonce conflicts:
// Account #19: 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199 (10000 ETH)
export const SIGNER_PRIVATE_KEY =
  "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e";

export const LOGGER: pino.Logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
  level: "debug",
});

export function encodeFunctionCall(
  web3: Web3,
  functionName: string,
  // web3.eth.abi.encodeFunctionCall() takes any data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
): Bytes {
  // This nonsense is needed due to known web3.js issues:
  // https://github.com/web3/web3.js/issues/6275
  // https://docs.web3js.org/guides/smart_contracts/infer_contract_types_guide/
  const functionAbi = abi.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => item.name === functionName && item.type === "function",
  )[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return web3.eth.abi.encodeFunctionCall(functionAbi as any, data);
}
