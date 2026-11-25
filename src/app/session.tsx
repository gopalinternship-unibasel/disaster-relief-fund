// The app's connection to a chain. Two networks:
// - Simulation: the in-browser chain with six test accounts. A campaign with the guide's settings is
//   deployed at start, the clock can be moved forward, and "Reset" starts a new chain with the
//   guide's campaign deployed again.
// - Sepolia: the public test network through a browser wallet (MetaMask). Campaigns the app
//   deploys or opens are remembered in this browser.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { http, createPublicClient, createWalletClient, custom, fallback, getAddress, type Address, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { DEMO_ACCOUNTS } from "../chain/accounts";
import { clientsFor, localChain, sepolia } from "../chain/clients";
import { createLocalChain, type LocalChainProvider } from "../chain/local-chain";
import { deployFund, type DeployArgs } from "../contract/fund";
import { GUIDE_CONFIG } from "../checks/harness";
import { discoverWallets, type WalletInfo } from "./wallets";

if (import.meta.env.DEV) {
  // Lets the end-to-end test build a stand-in wallet on the same in-browser chain. Not in builds.
  (window as unknown as { __createReliefChain?: typeof createLocalChain }).__createReliefChain = createLocalChain;
}

/** Opened by double-click: browser wallets do not reach such pages, and storage is shared by all files. */
export const OPENED_FROM_FILE = typeof location !== "undefined" && location.protocol === "file:";

export type NetworkMode = "simulation" | "sepolia";
export type CampaignRef = { address: Address; fromBlock: bigint; name?: string };

const SEPOLIA_HEX = "0xaa36a7";
/** Read-only Sepolia endpoint for visitors without a wallet. It answers long log queries. */
export const SEPOLIA_READ_RPC = "https://gateway.tenderly.co/public/sepolia";
const STORE_MODE = "relief-fund:mode";
const STORE_CAMPAIGNS = "relief-fund:sepolia-campaigns";
const STORE_WALLET = "relief-fund:wallet";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked (private window, file:// in some browsers): the app still works, it only forgets
  }
}

type StoredCampaign = { address: string; fromBlock: string; name?: string };

export type Session = {
  mode: NetworkMode;
  setMode(mode: NetworkMode): void;
  /** Null while the simulation starts or when Sepolia has no reader. */
  publicClient: PublicClient | null;
  /** Null when no account can sign (Sepolia without a connected wallet). */
  walletClient: WalletClient | null;
  account: Address | null;
  campaign: CampaignRef | null;
  campaigns: CampaignRef[];
  selectCampaign(ref: CampaignRef): void;
  forgetCampaign(address: Address): void;
  deploy(args: DeployArgs): Promise<CampaignRef & { hash: `0x${string}`; fee: bigint }>;
  /** Bumps after every transaction or clock change, so reads refresh at once. */
  version: number;
  bump(): void;
  starting: boolean;
  error: string | null;
  sim: {
    setAccount(index: number): void;
    accountIndex: number;
    reset(): Promise<void>;
    advance(seconds: number): Promise<void>;
    jumpTo(timestamp: bigint): Promise<void>;
    clock(): Promise<bigint>;
  } | null;
  wallet: {
    wallets: WalletInfo[];
    chosen: WalletInfo | null;
    choose(id: string): void;
    connect(): Promise<void>;
    switchToSepolia(): Promise<void>;
    chainOk: boolean;
    connected: boolean;
    connecting: boolean;
  } | null;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

type SimState = {
  provider: LocalChainProvider;
  publicClient: PublicClient;
  walletClient: WalletClient;
  campaigns: CampaignRef[];
  current: Address | null;
};

async function startSimulation(): Promise<SimState> {
  const provider = await createLocalChain();
  const { publicClient, walletClient } = clientsFor(provider, localChain);
  const result = await deployFund(walletClient, publicClient, DEMO_ACCOUNTS[0].address, GUIDE_CONFIG);
  const ref = { address: result.address, fromBlock: result.blockNumber, name: GUIDE_CONFIG.campaignName };
  return { provider, publicClient, walletClient, campaigns: [ref], current: ref.address };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>(() =>
    import.meta.env.MODE !== "artifact" && !OPENED_FROM_FILE && load<string>(STORE_MODE, "simulation") === "sepolia" ? "sepolia" : "simulation",
  );
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [error, setError] = useState<string | null>(null);

  // ---- Simulation --------------------------------------------------------------------------
  const [sim, setSim] = useState<SimState | null>(null);
  const [simAccount, setSimAccount] = useState(0);
  const simStarting = useRef<Promise<void> | null>(null);

  const bootSimulation = useCallback(async () => {
    setSim(null);
    try {
      const state = await startSimulation();
      setSim(state);
      setSimAccount(0);
      setError(null);
    } catch (e) {
      setError(`The in-browser chain could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (mode === "simulation" && !sim && !simStarting.current) {
      simStarting.current = bootSimulation().finally(() => {
        simStarting.current = null;
      });
    }
  }, [mode, sim, bootSimulation]);

  // ---- Sepolia -------------------------------------------------------------------------------
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletId, setWalletId] = useState<string | null>(() => load<string | null>(STORE_WALLET, null));
  const [sepAccount, setSepAccount] = useState<Address | null>(null);
  const [sepChainId, setSepChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sepCampaigns, setSepCampaigns] = useState<CampaignRef[]>(() => {
    const stored = load<unknown>(STORE_CAMPAIGNS, []);
    const out: CampaignRef[] = [];
    for (const c of Array.isArray(stored) ? (stored as StoredCampaign[]) : []) {
      try {
        out.push({ address: getAddress(c.address), fromBlock: BigInt(c.fromBlock), name: typeof c.name === "string" ? c.name : undefined });
      } catch {
        // a damaged entry is skipped instead of stopping the app
      }
    }
    return out;
  });
  const [sepCurrent, setSepCurrent] = useState<Address | null>(() => sepCampaigns[0]?.address ?? null);

  useEffect(() => (mode === "sepolia" ? discoverWallets(setWallets) : undefined), [mode]);
  const chosen = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? null;

  useEffect(() => {
    if (mode !== "sepolia" || !chosen) return;
    const provider = chosen.provider;
    let alive = true;
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      if (alive) setSepAccount(list[0] ? getAddress(list[0]) : null);
    };
    const onChain = (id: unknown) => alive && setSepChainId(String(id).toLowerCase());
    provider.request({ method: "eth_accounts" }).then(onAccounts).catch(() => undefined);
    provider.request({ method: "eth_chainId" }).then(onChain).catch(() => undefined);
    provider.on?.("accountsChanged", onAccounts as never);
    provider.on?.("chainChanged", onChain as never);
    return () => {
      alive = false;
      provider.removeListener?.("accountsChanged", onAccounts as never);
      provider.removeListener?.("chainChanged", onChain as never);
    };
  }, [mode, chosen]);

  const chainOk = sepChainId === SEPOLIA_HEX;
  const sepClients = useMemo(() => {
    if (mode !== "sepolia") return null;
    const wallet = chosen && chainOk ? chosen.provider : null;
    // Reads go to a public Sepolia endpoint that answers long log queries and old-block lookups;
    // the wallet's own endpoint is the fallback. The wallet only signs.
    const readOnlyThroughWallet = import.meta.env.DEV && Boolean((window as unknown as { __reliefReadThroughWallet?: boolean }).__reliefReadThroughWallet);
    const transports = [
      ...(readOnlyThroughWallet ? [] : [http(SEPOLIA_READ_RPC, { retryCount: 1, timeout: 20_000 })]),
      ...(wallet ? [custom(wallet)] : []),
    ];
    const publicClient = createPublicClient({ chain: sepolia, transport: fallback(transports), pollingInterval: 3_000 }) as PublicClient;
    const walletClient = wallet ? createWalletClient({ chain: sepolia, transport: custom(wallet) }) : null;
    return { publicClient, walletClient, chain: sepolia };
  }, [mode, chosen, chainOk]);

  const persistSep = useCallback((list: CampaignRef[]) => {
    setSepCampaigns(list);
    save(STORE_CAMPAIGNS, list.map((c) => ({ address: c.address, fromBlock: c.fromBlock.toString(), name: c.name })));
  }, []);

  // ---- Shared ----------------------------------------------------------------------------------
  const setMode = useCallback((m: NetworkMode) => {
    setModeState(m);
    save(STORE_MODE, m);
  }, []);

  const campaigns = mode === "simulation" ? (sim?.campaigns ?? []) : sepCampaigns;
  const currentAddress = mode === "simulation" ? sim?.current : sepCurrent;
  const campaign = campaigns.find((c) => c.address === currentAddress) ?? null;

  const selectCampaign = useCallback(
    (ref: CampaignRef) => {
      if (mode === "simulation") {
        setSim((s) => (s ? { ...s, current: ref.address, campaigns: s.campaigns.some((c) => c.address === ref.address) ? s.campaigns : [ref, ...s.campaigns] } : s));
      } else {
        const rest = sepCampaigns.filter((c) => c.address !== ref.address);
        persistSep([ref, ...rest]);
        setSepCurrent(ref.address);
      }
      bump();
    },
    [mode, sepCampaigns, persistSep, bump],
  );

  const forgetCampaign = useCallback(
    (address: Address) => {
      if (mode === "sepolia") {
        const rest = sepCampaigns.filter((c) => c.address !== address);
        persistSep(rest);
        if (sepCurrent === address) setSepCurrent(rest[0]?.address ?? null);
      }
    },
    [mode, sepCampaigns, sepCurrent, persistSep],
  );

  const publicClient = mode === "simulation" ? (sim?.publicClient ?? null) : (sepClients?.publicClient ?? null);
  const walletClient = mode === "simulation" ? (sim?.walletClient ?? null) : (sepClients?.walletClient ?? null);
  const account = mode === "simulation" ? (sim ? DEMO_ACCOUNTS[simAccount].address : null) : chainOk ? sepAccount : null;

  const deploy = useCallback(
    async (args: DeployArgs) => {
      if (!publicClient || !walletClient || !account) throw new Error("Connect an account that can sign first.");
      const result = await deployFund(walletClient, publicClient, account, args);
      const ref = { address: result.address, fromBlock: result.blockNumber, name: args.campaignName };
      selectCampaign(ref);
      return { ...ref, hash: result.hash, fee: result.fee };
    },
    [publicClient, walletClient, account, selectCampaign],
  );

  const simApi = useMemo<Session["sim"]>(() => {
    if (mode !== "simulation" || !sim) return null;
    const p = sim.provider;
    return {
      accountIndex: simAccount,
      setAccount: (i: number) => setSimAccount(i),
      reset: async () => {
        if (simStarting.current) return simStarting.current;
        const run = bootSimulation().finally(() => {
          simStarting.current = null;
        });
        simStarting.current = run;
        await run;
        bump();
      },
      advance: async (seconds: number) => {
        await p.request({ method: "evm_increaseTime", params: [seconds] });
        await p.request({ method: "evm_mine", params: [] });
        bump();
      },
      jumpTo: async (timestamp: bigint) => {
        await p.request({ method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] });
        await p.request({ method: "evm_mine", params: [] });
        bump();
      },
      clock: async () => BigInt(await p.request({ method: "relief_clock", params: [] })),
    };
  }, [mode, sim, simAccount, bootSimulation, bump]);

  const walletApi = useMemo<Session["wallet"]>(() => {
    if (mode !== "sepolia") return null;
    return {
      wallets,
      chosen,
      chainOk,
      connected: sepAccount !== null,
      connecting,
      choose: (id: string) => {
        setWalletId(id);
        save(STORE_WALLET, id);
      },
      connect: async () => {
        if (!chosen) throw new Error("No browser wallet found. Install MetaMask, then reload this page.");
        setConnecting(true);
        try {
          const accounts = (await chosen.provider.request({ method: "eth_requestAccounts" })) as string[];
          setSepAccount(accounts[0] ? getAddress(accounts[0]) : null);
          setSepChainId(String(await chosen.provider.request({ method: "eth_chainId" })).toLowerCase());
        } finally {
          setConnecting(false);
        }
      },
      switchToSepolia: async () => {
        if (!chosen) return;
        const provider = chosen.provider as EIP1193Provider;
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] });
        } catch (e) {
          // 4902: the wallet does not know Sepolia yet; add it, which also switches to it.
          if ((e as { code?: number }).code !== 4902) throw e;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: SEPOLIA_HEX,
                chainName: "Sepolia",
                nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [SEPOLIA_READ_RPC],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
        }
      },
    };
  }, [mode, wallets, chosen, chainOk, connecting, sepAccount]);

  const value: Session = {
    mode,
    setMode,
    publicClient,
    walletClient,
    account,
    campaign,
    campaigns,
    selectCampaign,
    forgetCampaign,
    deploy,
    version,
    bump,
    starting: mode === "simulation" && !sim && !error,
    error,
    sim: simApi,
    wallet: walletApi,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
