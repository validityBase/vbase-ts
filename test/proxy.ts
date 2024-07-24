import { getLocal } from "mockttp";

const proxy = getLocal();

(async () => {
  // Hardhat node runs on port 8545.
  // Proxy it on port 8545 + 1.
  await proxy.start(8546);

  // Forward all requests to the local Hardhat test node with variable delays.
  proxy.forAnyRequest().thenForwardTo("http://localhost:8545", {
    beforeRequest: async (request) => {
      // Add variable delay [0, 5 * 1000] ms to the request.
      const delay = Math.floor(Math.random() * 5 * 1000);
      console.log(`Request: ${JSON.stringify(request)}`);
      console.log(`Delaying request by ${delay} ms`);
      // Disable warning the proxy request type check -- this is a passthrough.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Promise<any>((resolve) =>
        setTimeout(() => resolve(request), delay),
      );
    },
    beforeResponse: async (response) => {
      // Add variable delay [0, 5 * 1000] ms to the response.
      const delay = Math.floor(Math.random() * 5 * 1000);
      console.log(`Response: ${JSON.stringify(response)}`);
      console.log(`Delaying response by ${delay} ms`);
      // Disable warning the proxy response type check -- this is a passthrough.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Promise<any>((resolve) =>
        setTimeout(() => resolve(response), delay),
      );
    },
  });
  console.log("Proxy running on http://localhost:8546");
})();

process.on("SIGINT", async () => {
  await proxy.stop();
  console.log("Proxy stopped");
});
