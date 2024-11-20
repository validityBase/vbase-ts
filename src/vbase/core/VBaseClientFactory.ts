import VBaseClient from "./VBaseClient"
import artifact from "../../common/contracts/CommitmentService.json";
import testArtifact from "../../common/contracts/CommitmentServiceTest.json";

/**
 * vBaseClientFactory is a factory class for creating instances of vBaseClient
 */
export class VBaseClientFactory {
    /**
     * Create a new vBaseClient instance
     * @param NODE_RPC_URL 
     * @param COMMITMENT_SERVICE_ADDRESS 
     * @returns 
     */
    static createClient(
        NODE_RPC_URL: string,
        COMMITMENT_SERVICE_ADDRESS: string,
    ): VBaseClient {
        return new VBaseClient(NODE_RPC_URL, COMMITMENT_SERVICE_ADDRESS, artifact);
    }

    /**
     * Create a new vBaseClient instance for testing
     * @param NODE_RPC_URL 
     * @param COMMITMENT_SERVICE_ADDRESS 
     * @returns 
     */
    static createClientTest(
        NODE_RPC_URL: string,
        COMMITMENT_SERVICE_ADDRESS: string,
    ): VBaseClient {
        return new VBaseClient(NODE_RPC_URL, COMMITMENT_SERVICE_ADDRESS, testArtifact);
    }
}
