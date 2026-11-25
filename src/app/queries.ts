// Reading the contract with TanStack Query. Every key carries the network, the contract address and
// the session's version number, which bumps after each transaction or clock change.
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { DEMO_ACCOUNTS } from "../chain/accounts";
import { callFund, enrichEvents, explainError, precheck, readCampaign, readEvents, type CampaignState, type FundEvent, type TxResult } from "../contract/fund";
import { useSession } from "./session";

/**
 * Keeps showing the previous result while a refresh loads, but only for the same network, contract
 * (and account): never another campaign's numbers under a new header.
 */
function keepWithin<T>(key: QueryKey, scope: number) {
  return (previous: T | undefined, previousQuery?: { queryKey: QueryKey }) =>
    previousQuery && key.slice(0, scope).every((part, i) => part === previousQuery.queryKey[i]) ? previous : undefined;
}

export function useCampaign() {
  const s = useSession();
  const queryKey = ["campaign", s.mode, s.campaign?.address, s.version];
  return useQuery<CampaignState>({
    queryKey,
    queryFn: () => readCampaign(s.publicClient!, s.campaign!.address),
    enabled: Boolean(s.publicClient && s.campaign),
    placeholderData: keepWithin<CampaignState>(queryKey, 3),
    refetchInterval: s.mode === "simulation" ? 4_000 : 12_000,
  });
}

/**
 * The contract's events. The key includes a fingerprint of the state, so the history is read again
 * whenever the totals change (for example a teammate's donation on Sepolia) and the two agree.
 */
export function useEvents() {
  const s = useSession();
  const state = useCampaign().data;
  const fingerprint = state
    ? [state.totalDonated, state.balance, state.allocated, state.pending.food, state.pending.shelter, state.pending.medical].join("|")
    : "none";
  const queryKey = ["events", s.mode, s.campaign?.address, s.version, fingerprint];
  return useQuery<FundEvent[]>({
    queryKey,
    queryFn: async () => enrichEvents(s.publicClient!, await readEvents(s.publicClient!, s.campaign!.address, s.campaign!.fromBlock)),
    enabled: Boolean(s.publicClient && s.campaign),
    placeholderData: keepWithin<FundEvent[]>(queryKey, 3),
    refetchInterval: s.mode === "simulation" ? false : 60_000,
  });
}

/** Balances of the six simulation accounts, or of the connected wallet on Sepolia. */
export function useBalances() {
  const s = useSession();
  const addresses: Address[] = s.mode === "simulation" ? DEMO_ACCOUNTS.map((a) => a.address) : s.account ? [s.account] : [];
  const queryKey = ["balances", s.mode, addresses.join(","), s.version];
  return useQuery<Record<string, bigint>>({
    queryKey,
    queryFn: async () => {
      const values = await Promise.all(addresses.map((a) => s.publicClient!.getBalance({ address: a })));
      return Object.fromEntries(addresses.map((a, i) => [a, values[i]]));
    },
    enabled: Boolean(s.publicClient && addresses.length),
    placeholderData: keepWithin<Record<string, bigint>>(queryKey, 3),
  });
}

/** What the contract would say to each of the three functions for the acting account, right now. */
export function usePrechecks(donateValue: bigint) {
  const s = useSession();
  const value = donateValue > 0n ? donateValue : 1n;
  const queryKey = ["precheck", s.mode, s.campaign?.address, s.account, value.toString(), s.version];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const [donate, allocateFunds, withdraw] = await Promise.all([
        precheck(s.publicClient!, s.campaign!.address, s.account!, "donate", value),
        precheck(s.publicClient!, s.campaign!.address, s.account!, "allocateFunds"),
        precheck(s.publicClient!, s.campaign!.address, s.account!, "withdraw"),
      ]);
      return { donate, allocateFunds, withdraw };
    },
    enabled: Boolean(s.publicClient && s.campaign && s.account),
    placeholderData: keepWithin<{ donate: string | null; allocateFunds: string | null; withdraw: string | null }>(queryKey, 4),
    refetchInterval: s.mode === "simulation" ? 4_000 : 12_000,
  });
}

export type TxNotice =
  | { kind: "done"; label: string; result: TxResult }
  | { kind: "error"; label: string; message: string }
  | { kind: "reverted"; label: string; hash: string; blockNumber: bigint; fee: bigint; message: string }
  | { kind: "unknown"; label: string; hash: string; message: string };

/** Sends donate(), allocateFunds() or withdraw() from the acting account, then refreshes everything. */
export function useFundCall() {
  const s = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fn, value }: { fn: "donate" | "allocateFunds" | "withdraw"; value?: bigint }) => {
      if (!s.walletClient || !s.publicClient || !s.campaign || !s.account) throw new Error("Connect an account that can sign first.");
      return callFund(s.walletClient, s.publicClient, s.campaign.address, s.account, fn, value ?? 0n);
    },
    onSettled: () => {
      s.bump();
      qc.invalidateQueries();
    },
  });
}

export { explainError };

/**
 * The chain's clock, ticking every second.
 * - Simulation: the time the next block would get, read from the in-page chain every second (it
 *   can be ahead of the computer's clock after "Skip to deadline" or quick transactions).
 * - Sepolia: the newest block's time, read every 12 seconds, plus the seconds since; until the
 *   first read it is the computer's clock.
 * Switching network starts the clock again from that network's own source.
 */
export function useChainClock(): bigint | null {
  const s = useSession();
  const [base, setBase] = useState<{ chain: bigint; at: number; mode: string } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let alive = true;
    const set = (t: bigint) => alive && setBase({ chain: t, at: Date.now(), mode: s.mode });
    let timer: number | undefined;
    if (s.mode === "simulation" && s.sim) {
      const sim = s.sim;
      const read = () => sim.clock().then(set).catch(() => undefined);
      read();
      timer = window.setInterval(read, 1_000);
    } else if (s.mode === "sepolia") {
      set(BigInt(Math.floor(Date.now() / 1000)));
      const read = () =>
        s.publicClient
          ?.getBlock({ blockTag: "latest" })
          .then((b) => set(b.timestamp))
          .catch(() => undefined);
      read();
      timer = window.setInterval(read, 12_000);
    }
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [s.mode, s.sim, s.publicClient, s.version]);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!base || base.mode !== s.mode) return null;
  return base.chain + BigInt(Math.floor((Date.now() - base.at) / 1000));
}
