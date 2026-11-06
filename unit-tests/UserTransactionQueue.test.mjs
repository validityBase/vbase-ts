import { escalatedSendTransaction } from "../dist/vbase/transactions.js";
import txSettings from "../dist/vbase/txSettings.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { withUserTransaction } from "../dist/vbase/userTransactionQueue.js";

test("same user queues across signers while another user can finish", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const one = withUserTransaction("chain:alice", async () => {
    calls.push("first");
    await gate;
  });
  const two = withUserTransaction("chain:alice", async () => {
    calls.push("second");
  });
  await withUserTransaction("chain:bob", async () => {
    calls.push("other");
  });
  assert.deepEqual(calls, ["first", "other"]);
  release();
  await Promise.all([one, two]);
  assert.deepEqual(calls, ["first", "other", "second"]);
});

test("failed operation releases ownership without poisoning the queue", async () => {
  const one = withUserTransaction("chain:alice", async () => {
    throw new Error("failed");
  });
  const two = withUserTransaction("chain:alice", async () => 42);
  await assert.rejects(one, /failed/);
  assert.equal(await two, 42);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const logger = { debug() {}, info() {}, error() {} };
const address = "0x" + "Aa".repeat(20);

function transactionClient(
  account = address,
  chain = 1n,
  receipt = async () => ({ status: 1n }),
) {
  const calls = { gas: 0, nonce: 0, send: 0 };
  const web3 = {
    eth: {
      getChainId: async () => chain,
      getGasPrice: async () => {
        calls.gas += 1;
        return 1000n;
      },
      getTransactionReceipt: receipt,
    },
  };
  const signer = {
    getAddress: async () => account,
    provider: {
      getTransactionCount: async () => {
        calls.nonce += 1;
        return 0;
      },
    },
    sendTransaction: async () => {
      calls.send += 1;
      return { hash: "0xtest" };
    },
  };
  return {
    calls,
    web3,
    signer,
    run: () =>
      escalatedSendTransaction(web3, signer, account, "0x", logger, 100000),
  };
}

async function withFastReceipts(operation) {
  const saved = { ...txSettings };
  txSettings.txCompletionCheckInterval = 0;
  txSettings.txCompletionCheckRndInterval = 0;
  txSettings.maxGasPriceEscalations = 1;
  try {
    await operation();
  } finally {
    Object.assign(txSettings, saved);
  }
}

test("exported wrapper normalizes signer casing and owns receipt completion", async () => {
  await withFastReceipts(async () => {
    const entered = deferred();
    const release = deferred();
    const first = transactionClient(address, 1n, async () => {
      entered.resolve();
      return release.promise;
    });
    const second = transactionClient(address.toLowerCase());
    const one = first.run();
    await entered.promise;
    const two = second.run();
    try {
      await new Promise(setImmediate);
      assert.deepEqual(second.calls, { gas: 0, nonce: 0, send: 0 });
    } finally {
      release.resolve({ status: 1n });
    }
    await Promise.all([one, two]);
    assert.deepEqual(second.calls, { gas: 1, nonce: 1, send: 1 });
  });
});

test("exported wrapper releases the next signer after rejection", async () => {
  await withFastReceipts(async () => {
    const first = transactionClient();
    first.web3.eth.getGasPrice = async () => {
      throw new Error("RPC unavailable");
    };
    const second = transactionClient();
    const one = first.run();
    const two = second.run();
    await assert.rejects(one, /RPC unavailable/);
    assert.equal((await two).status, 1n);
    assert.equal(second.calls.send, 1);
  });
});

test("exported wrapper permits different chains and accounts during a pending receipt", async () => {
  await withFastReceipts(async () => {
    const entered = deferred();
    const release = deferred();
    const first = transactionClient(address, 1n, async () => {
      entered.resolve();
      return release.promise;
    });
    const one = first.run();
    await entered.promise;
    try {
      const otherChain = transactionClient(address, 2n);
      const otherAccount = transactionClient("0x" + "Bb".repeat(20), 1n);
      await Promise.all([otherChain.run(), otherAccount.run()]);
      assert.equal(otherChain.calls.send, 1);
      assert.equal(otherAccount.calls.send, 1);
    } finally {
      release.resolve({ status: 1n });
    }
    await one;
  });
});
