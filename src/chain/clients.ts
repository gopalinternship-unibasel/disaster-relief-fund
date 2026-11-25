import { createPublicClient, createWalletClient, custom, defineChain, type Chain, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { sepolia } from "viem/chains";
import { LOCAL_CHAIN_ID } from "./local-chain";

export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "In-browser chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

export { sepolia };

export type Clients = { publicClient: PublicClient; walletClient: WalletClient; chain: Chain };

/** viem clients that send every request through an EIP-1193 provider (the in-browser chain or MetaMask). */
export function clientsFor(provider: { request(args: { method: string; params?: unknown }): Promise<unknown> }, chain: Chain): Clients {
  const transport = custom(provider as EIP1193Provider);
  // The in-browser chain mines at once, so a short poll returns its receipts quickly; Sepolia
  // makes a block every 12 seconds, so polling every 2 seconds is enough there.
  const publicClient = createPublicClient({ chain, transport, pollingInterval: chain.id === LOCAL_CHAIN_ID ? 50 : 2_000 }) as PublicClient;
  const walletClient = createWalletClient({ chain, transport });
  return { publicClient, walletClient, chain };
}
