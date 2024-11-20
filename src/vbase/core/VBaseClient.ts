import { ethers, Contract, JsonRpcProvider } from 'ethers';

interface Artifact {
    abi: any[];
}

class VBaseClient {
    private NODE_RPC_URL: string;
    private COMMITMENT_SERVICE_ADDRESS: string;
    private artifact: Artifact;
    private provider: JsonRpcProvider | null = null;
    private commitmentService: Contract | null = null;
    private ethersWallet: ethers.Wallet | null = null;

    constructor(NODE_RPC_URL: string, COMMITMENT_SERVICE_ADDRESS: string, artifact: Artifact) {
        this.NODE_RPC_URL = NODE_RPC_URL;
        this.COMMITMENT_SERVICE_ADDRESS = COMMITMENT_SERVICE_ADDRESS;
        this.artifact = artifact;
    }

    async initWallet(WALLET_PRIVATE_KEY:string): Promise<void> {
        this.ethersWallet = new ethers.Wallet(
            WALLET_PRIVATE_KEY,
            this.provider,
          );
    }
    async init(): Promise<void> {
        this.provider = new ethers.JsonRpcProvider(this.NODE_RPC_URL);
        this.commitmentService = new ethers.Contract(
            this.COMMITMENT_SERVICE_ADDRESS,
            this.artifact.abi,
            this.provider
        );
    }

    /***
     * Add a set to the commitment service
     * @param hash - The hash of the set to add
     * @returns void
     */
    async addSet(hash: string): Promise<void> {
        if (!this.commitmentService) throw new Error("vBaseClient is not initialized.");
        try {
            const tx = await this.commitmentService.addSet(hash);
            console.log("addSet transaction submitted:", tx.hash);
            // await tx.wait();
            // console.log("addSet transaction confirmed!");
        } catch (error: any) {
            console.error("Failed to add set:", error.message);
        }
    }

    /**
     * Verify user sets in the commitment service
     * @param owner 
     * @param hash 
     * @returns 
     */
    async verifyUserSets(owner: string, hash: string): Promise<any> {
        if (!this.commitmentService) throw new Error("vBaseClient is not initialized.");
        try {
            const result = await this.commitmentService.verifyUserSets(owner, hash);
            console.log("verifyUserSets result:", result);
            return result;
        } catch (error: any) {
            console.error("Failed to verify user sets:", error.message);
        }
    }

    /**
     * Serialize a VbaseClient instance to a JSON object
     * @returns 
     */
    toJSON(): Record<string, any> {
        return {
            NODE_RPC_URL: this.NODE_RPC_URL,
            COMMITMENT_SERVICE_ADDRESS: this.COMMITMENT_SERVICE_ADDRESS,
            artifact: this.artifact,
        };
    }

    /**
     * Deserialize a JSON object to a VbaseClient instanceVbas
     * @param json 
     * @returns 
     */
    static fromJSON(json: Record<string, any>): VBaseClient {
        const { NODE_RPC_URL, COMMITMENT_SERVICE_ADDRESS, artifact } = json;
        return new VBaseClient(NODE_RPC_URL, COMMITMENT_SERVICE_ADDRESS, artifact);
    }
}

export default VBaseClient;
