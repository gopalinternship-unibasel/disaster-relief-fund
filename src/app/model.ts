// Turns the contract's raw state and events into what the pages show. Pure functions, unit-tested.
import type { Address } from "viem";
import { CATEGORIES, splitTotal, type CampaignState, type CategoryKey, type FundEvent } from "../contract/fund";

export type Phase = "open" | "awaiting-allocation" | "withdrawals" | "finished";

export type CategoryView = {
  key: CategoryKey;
  label: string;
  percent: bigint;
  recipient: Address;
  /** Credit recorded by allocateFunds(), or what it would record now if not allocated yet. */
  credit: bigint;
  projected: boolean;
  withdrawn: bigint;
  owed: bigint;
  withdrawBlock: bigint | null;
};

export type DonorView = { donor: Address; amount: bigint; count: number; firstBlock: bigint };

export type CampaignView = {
  phase: Phase;
  /** False while the event history is missing (still loading, or the read failed). */
  historyLoaded: boolean;
  deadlinePassed: boolean;
  categories: CategoryView[];
  donors: DonorView[];
  /** Null when the history is not loaded. */
  donationCount: number | null;
  paidOut: bigint;
  /** ETH the events say the contract should hold: donations minus withdrawals. */
  heldByEvents: bigint;
  allocationBlock: bigint | null;
  allocationCaller: Address | null;
  withdrawalsDone: number;
  /** Categories with a positive credit (zero credits have nothing to withdraw). */
  withdrawalsExpected: number;
};

export function viewOf(state: CampaignState, events: FundEvent[] | undefined, chainNow: bigint): CampaignView {
  const historyLoaded = events !== undefined;
  events = events ?? [];
  const deadlinePassed = chainNow >= state.endTime;
  const projected = !state.allocated;
  const split = splitTotal(state.totalDonated, state.percents.food, state.percents.shelter);
  const allocation = events.find((e) => e.kind === "allocation");

  const categories: CategoryView[] = CATEGORIES.map(({ key, label }) => {
    const recipient = state.recipients[key];
    const withdrawals = events.filter((e) => e.kind === "withdrawal" && e.recipient.toLowerCase() === recipient.toLowerCase());
    const recorded = allocation && allocation.kind === "allocation" ? allocation[key] : split[key];
    let withdrawn = withdrawals.reduce((sum, e) => sum + (e.kind === "withdrawal" ? e.amount : 0n), 0n);
    // Without the history, the state still tells: a recorded credit that now reads 0 was withdrawn.
    if (withdrawn === 0n && state.allocated && recorded > 0n && state.pending[key] === 0n) withdrawn = recorded;
    return {
      key,
      label,
      percent: state.percents[key],
      recipient,
      credit: projected ? split[key] : recorded,
      projected,
      withdrawn,
      owed: projected ? 0n : state.pending[key],
      withdrawBlock: withdrawals[0]?.blockNumber ?? null,
    };
  });

  const donorMap = new Map<string, DonorView>();
  for (const e of events) {
    if (e.kind !== "donation") continue;
    const k = e.donor.toLowerCase();
    const d = donorMap.get(k);
    if (d) {
      d.amount += e.amount;
      d.count += 1;
    } else donorMap.set(k, { donor: e.donor, amount: e.amount, count: 1, firstBlock: e.blockNumber });
  }
  const donors = [...donorMap.values()];
  const donationCount = historyLoaded ? events.filter((e) => e.kind === "donation").length : null;
  const paidOut = categories.reduce((sum, c) => sum + c.withdrawn, 0n);
  const donated = events.reduce((sum, e) => sum + (e.kind === "donation" ? e.amount : 0n), 0n);

  const withdrawalsExpected = state.allocated ? categories.filter((c) => c.credit > 0n).length : 3;
  const withdrawalsDone = categories.filter((c) => c.withdrawn > 0n).length;

  let phase: Phase;
  if (!deadlinePassed && !state.allocated) phase = "open";
  else if (!state.allocated) phase = "awaiting-allocation";
  else if (categories.some((c) => c.owed > 0n)) phase = "withdrawals";
  else phase = "finished";

  return {
    phase,
    historyLoaded,
    deadlinePassed,
    categories,
    donors,
    donationCount,
    paidOut,
    heldByEvents: donated - paidOut,
    allocationBlock: allocation?.blockNumber ?? null,
    allocationCaller: allocation && allocation.kind === "allocation" ? (allocation.caller ?? null) : null,
    withdrawalsDone,
    withdrawalsExpected,
  };
}

/** Running contract balance after each event, computed from the events alone. */
export function balancesAfter(events: FundEvent[]): Map<FundEvent, bigint> {
  const out = new Map<FundEvent, bigint>();
  let balance = 0n;
  for (const e of events) {
    if (e.kind === "donation") balance += e.amount;
    if (e.kind === "withdrawal") balance -= e.amount;
    out.set(e, balance);
  }
  return out;
}

/**
 * What an address is in this campaign: one of its recipients, its creator, or nothing. Roles come
 * from the open campaign, not from the simulation's account names.
 */
export function campaignRole(address: string, state: Pick<CampaignState, "creator" | "recipients">): string | null {
  const a = address.toLowerCase();
  for (const { key, label } of CATEGORIES) {
    if (state.recipients[key].toLowerCase() === a) return `${label.toLowerCase()} recipient`;
  }
  if (state.creator.toLowerCase() === a) return "organizer";
  return null;
}
