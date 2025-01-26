import { getLocal, CompletedRequest } from "mockttp";
import { PassThroughResponse } from "mockttp/dist/rules/requests/request-handler-definitions";

// The target (proxied) and the proxy ports.
const TGT_PORT = 8545;
const PROXY_PORT = 8546;

// Read configuration from environment variables with defaults.
// The maximum request or response delay (in milliseconds).
const MAX_DELAY_MS = parseInt(process.env.MAX_DELAY_MS || "5000", 10);
// The probability of failing eth_getTransactionReceipt with TransactionNotFound.
// This is used to simulate tardy nodes that do not return a transaction receipt
// for a mined transaction as Alchemy has been doing.
const TX_NOT_FOUND_FAILURE_PROBABILITY = parseFloat(process.env.TX_NOT_FOUND_FAILURE_PROBABILITY || "0.5");

console.log(`Proxy Configuration:
  MAX_DELAY_MS: ${MAX_DELAY_MS} ms
  TX_NOT_FOUND_FAILURE_PROBABILITY: ${TX_NOT_FOUND_FAILURE_PROBABILITY}`
);

// Define the function to add a random delay.
const addRandomDelay = async (): Promise<void> => {
  const delay = Math.floor(Math.random() * MAX_DELAY_MS);
  console.log(`Delaying by ${delay} ms`);
  return new Promise((resolve) => setTimeout(resolve, delay));
};

// Decode a request or response message's body.
// Disable warning the proxy request type check -- this is a passthrough.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const printBody = (msg: CompletedRequest | PassThroughResponse) => {
  // Decode and log the request body.
  const body = msg.body?.buffer
    ? Buffer.from(msg.body.buffer).toString("utf-8")
    : null;
  console.log(`Body: ${body ? JSON.stringify(JSON.parse(body), null, 2) : "No body"}`);
};

// Determine if a request is a eth_getTransactionReceipt call
// that should fail with TransactionNotFound.
const failWithTxNotFoundIfNecessary = (request: CompletedRequest) => {

  // Parse out the request body.
  const body = request.body?.buffer
    ? Buffer.from(request.body.buffer).toString("utf-8")
    : null;
  if (!body) {
    console.log("FailWithTxNotFoundIfNecessary: Empty body");
    return;
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(body);
  } catch (error) {
     // If body parsing fails, do not fail the request.
     console.log("FailWithTxNotFoundIfNecessary: Failed to parse body: " + error);
     return;
  }
  // If body parsing succeeds and we have a request to fail with a given probability,
  // fail the request.
  if (parsedBody.method === "eth_getTransactionReceipt") {
    console.log("FailWithTxNotFoundIfNecessary: Got a eth_getTransactionReceipt request");
    if (Math.random() < TX_NOT_FOUND_FAILURE_PROBABILITY) {
      console.log("FailWithTxNotFoundIfNecessary: Failing with TransactionNotFound");
      // This is not the right way to simulate a transaction not found, but it is good enough.
      // as all errors from eth_getTransactionReceipt are processed the same way.
      throw {
        name: "TransactionNotFound",
        code: 430,
        message: "Transaction not found",
      };
    }
  }
};

// Function to process requests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processRequest = async (request: CompletedRequest): Promise<any> => {
  console.log(`Request: ${JSON.stringify(request)}`);
  printBody(request);
  await addRandomDelay();
  failWithTxNotFoundIfNecessary(request);
  return request;
};

// Function to process responses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processResponse = async (response: PassThroughResponse): Promise<any> => {
  console.log(`Response: ${JSON.stringify(response)}`);
  printBody(response);
  await addRandomDelay();
  return response;
};

// Main proxy setup.
const proxy = getLocal();

(async () => {
  // Start the proxy on the proxy port.
  await proxy.start(PROXY_PORT);

  proxy.forAnyRequest().thenForwardTo("http://localhost:" + TGT_PORT, {
    beforeRequest: processRequest,
    beforeResponse: processResponse,
  });

  console.log("Proxy running on http://localhost:" + PROXY_PORT);
})();

process.on("SIGINT", async () => {
  await proxy.stop();
  console.log("Proxy stopped");
});
