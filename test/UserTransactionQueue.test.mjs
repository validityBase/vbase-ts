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
