import { getLocal, CompletedRequest } from "mockttp";
import { PassThroughResponse } from "mockttp/dist/rules/requests/request-handler-definitions";

// Define the maximum delay (in milliseconds).
const MAX_DELAY_MS = 5 * 1000;

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

// Function to process requests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processRequest = async (request: CompletedRequest): Promise<any> => {
  console.log(`Request: ${JSON.stringify(request)}`);
  printBody(request);
  await addRandomDelay();
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
  // Start the proxy on port 8546
  await proxy.start(8546);

  proxy.forAnyRequest().thenForwardTo("http://localhost:8545", {
    beforeRequest: processRequest,
    beforeResponse: processResponse,
  });

  console.log("Proxy running on http://localhost:8546");
})();

process.on("SIGINT", async () => {
  await proxy.stop();
  console.log("Proxy stopped");
});
