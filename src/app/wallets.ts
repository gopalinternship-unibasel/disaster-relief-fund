// Finds browser wallets. EIP-6963 lets every installed wallet announce itself, so MetaMask can be
// picked even when another wallet (Brave Wallet, Coinbase Wallet) also claims window.ethereum.
import type { EIP1193Provider } from "viem";

export type WalletInfo = { id: string; name: string; icon?: string; provider: EIP1193Provider };

type AnnounceEvent = CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider }>;

export function discoverWallets(onChange: (wallets: WalletInfo[]) => void): () => void {
  const found = new Map<string, WalletInfo>();
  const publish = () => onChange([...found.values()].sort((a, b) => rank(a) - rank(b)));

  const onAnnounce = (event: Event) => {
    const { info, provider } = (event as AnnounceEvent).detail;
    found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, provider });
    publish();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Older wallets only set window.ethereum.
  const legacy = (window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean } }).ethereum;
  const timer = window.setTimeout(() => {
    if (legacy && found.size === 0) {
      found.set("injected", { id: "injected", name: legacy.isMetaMask ? "MetaMask" : "Browser wallet", provider: legacy });
      publish();
    }
  }, 300);

  publish();
  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    window.clearTimeout(timer);
  };
}

/** MetaMask first: the build guide uses it. */
function rank(w: WalletInfo) {
  if (w.id === "io.metamask" || /metamask/i.test(w.name)) return 0;
  return 1;
}
