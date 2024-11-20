import { ethers, Signer } from "ethers";
import { Web3 } from "web3";
import HDWalletProvider from "@truffle/hdwallet-provider";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

export const COMMITMENT_SERVICE_ADDRESS =
  process.env.COMMITMENT_SERVICE_ADDRESS;
export const COMMITMENT_SERVICE_TEST_ADDRESS =
  process.env.COMMITMENT_SERVICE_TEST_ADDRESS;
export const NODE_RPC_URL = process.env.NODE_RPC_URL;
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

export const provider = new HDWalletProvider({
  privateKeys: [WALLET_PRIVATE_KEY],
  providerOrUrl: NODE_RPC_URL,
});
// Web3 expects a slightly different type from HDWalletProvider, so requires a cast.
export const web3: Web3 = new Web3(provider as any);
web3.eth.defaultAccount = provider.getAddress(0);

export const ethersProvider = new ethers.JsonRpcProvider(NODE_RPC_URL);
export const ethersWallet = new ethers.Wallet(
  WALLET_PRIVATE_KEY,
  ethersProvider,
);

// Used the wallet as the signer directly.
// We can't use NonceManager since the class does not handle errors well.
// We need to manually set the nonce so that we can
// handle errors and resend transactions with a higher gas price.
export const signer: Signer = ethersWallet;
