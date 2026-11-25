// Everything the app (and the tests) do with a DisasterReliefFund contract: deploy it, read its
// state and events, and call its three functions. Calls are simulated first, so a call the
// contract would reject shows the contract's own reason and no transaction is sent.
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeErrorResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  parseEventLogs,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { fundAbi, fundBytecode } from "./artifact";

export const CATEGORIES = [
  { key: "food", label: "Food and water" },
  { key: "shelter", label: "Shelter" },
  { key: "medical", label: "Medical supplies" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export type DeployArgs = {
  campaignName: string;
  foodRecipient: Address;
  shelterRecipient: Address;
  medicalRecipient: Address;
  durationMinutes: bigint;
  foodPercent: bigint;
  shelterPercent: bigint;
  medicalPercent: bigint;
};

export type CampaignState = {
  address: Address;
  campaignName: string;
  creator: Address;
  recipients: Record<CategoryKey, Address>;
  percents: Record<CategoryKey, bigint>;
  endTime: bigint;
  totalDonated: bigint;
  allocated: boolean;
  /** pendingWithdrawals[recipient] for the three recipients: credit not yet withdrawn. */
  pending: Record<CategoryKey, bigint>;
  /** ETH the contract holds right now. */
  balance: bigint;
  /** Timestamp of the newest block: the time a view call sees. */
  chainTime: bigint;
  blockNumber: bigint;
};

export type FundEvent =
  | { kind: "donation"; donor: Address; amount: bigint; blockNumber: bigint; txHash: Hash; logIndex: number; timestamp?: bigint }
  | { kind: "allocation"; food: bigint; shelter: bigint; medical: bigint; blockNumber: bigint; txHash: Hash; logIndex: number; timestamp?: bigint; caller?: Address }
  | { kind: "withdrawal"; recipient: Address; amount: bigint; blockNumber: bigint; txHash: Hash; logIndex: number; timestamp?: bigint };

export type TxResult = { hash: Hash; blockNumber: bigint; gasUsed: bigint; fee: bigint };

/** The three credits the contract records for a total, exactly as allocateFunds() computes them. */
export function splitTotal(total: bigint, foodPercent: bigint, shelterPercent: bigint) {
  const food = (total * foodPercent) / 100n;
  const shelter = (total * shelterPercent) / 100n;
  return { food, shelter, medical: total - food - shelter };
}

/** Why the constructor would reject these inputs, using the contract's own messages, in its order. */
export const MAX_UINT = 2n ** 256n - 1n;

export function constructorProblem(a: DeployArgs, now = BigInt(Math.floor(Date.now() / 1000))): string | null {
  const zero = "0x0000000000000000000000000000000000000000";
  for (const v of [a.durationMinutes, a.foodPercent, a.shelterPercent, a.medicalPercent]) {
    if (v > MAX_UINT) return "A number is larger than a uint can hold";
  }
  if (a.durationMinutes <= 0n) return "Duration must be positive";
  const r = [a.foodRecipient, a.shelterRecipient, a.medicalRecipient].map((x) => x.toLowerCase());
  if (r.some((x) => x === zero)) return "Zero recipient";
  if (r[0] === r[1] || r[0] === r[2] || r[1] === r[2]) return "Recipients must differ";
  if (a.foodPercent <= 0n || a.shelterPercent <= 0n || a.medicalPercent <= 0n) return "Percentages must be positive";
  // Solidity 0.8 checks arithmetic: a sum or product past the uint limit reverts with a Panic.
  if (a.foodPercent + a.shelterPercent > MAX_UINT || a.foodPercent + a.shelterPercent + a.medicalPercent > MAX_UINT)
    return "Arithmetic overflow: a number is too large for the contract's calculation";
  if (a.foodPercent + a.shelterPercent + a.medicalPercent !== 100n) return "Percentages must total 100";
  if (a.durationMinutes * 60n > MAX_UINT || now + a.durationMinutes * 60n > MAX_UINT)
    return "Arithmetic overflow: a number is too large for the contract's calculation";
  return null;
}

/** A transaction that was sent and mined, but reverted: it cost gas. */
export class MinedRevertError extends Error {
  constructor(
    readonly hash: Hash,
    readonly blockNumber: bigint,
    readonly fee: bigint,
    readonly reason: string,
  ) {
    super(`Mined in block ${blockNumber} but reverted: ${reason}`);
  }
}

/** A transaction that was sent, but whose outcome could not be read (for example a timeout). */
export class SentUnknownError extends Error {
  constructor(
    readonly hash: Hash,
    readonly detail: string,
  ) {
    super(`Sent as ${hash}, but its result could not be read: ${detail}`);
  }
}

async function receiptFor(publicClient: PublicClient, hash: Hash, replay?: () => Promise<unknown>): Promise<TxResult> {
  let receipt;
  try {
    // Sepolia usually includes a transaction within a few 12-second blocks; allow up to 5 minutes.
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000, retryCount: 10 });
  } catch (e) {
    throw new SentUnknownError(hash, explainError(e));
  }
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.status !== "success") {
    // Replaying the call against the state at that block usually yields the contract's reason.
    let reason = "the contract reverted it";
    if (replay) {
      try {
        await replay();
      } catch (e) {
        reason = explainError(e);
      }
    }
    throw new MinedRevertError(hash, receipt.blockNumber, fee, reason);
  }
  return { hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, fee };
}

export async function deployFund(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: Address,
  args: DeployArgs,
  bytecode: `0x${string}` = fundBytecode,
): Promise<TxResult & { address: Address }> {
  const ctorArgs = [
    args.campaignName,
    args.foodRecipient,
    args.shelterRecipient,
    args.medicalRecipient,
    args.durationMinutes,
    args.foodPercent,
    args.shelterPercent,
    args.medicalPercent,
  ] as const;
  // Ask the chain first: a constructor that would revert gives its reason here, and nothing is sent.
  const data = encodeDeployData({ abi: fundAbi, bytecode, args: ctorArgs });
  await publicClient.call({ account, data });
  const nonce = await publicClient.getTransactionCount({ address: account });
  const hash = await walletClient.deployContract({
    abi: fundAbi,
    bytecode,
    args: ctorArgs,
    account,
    chain: walletClient.chain,
  });
  const result = await receiptFor(publicClient, hash);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const address = getAddress(receipt.contractAddress ?? getContractAddress({ from: account, nonce: BigInt(nonce) }));
  return { ...result, address };
}

export async function readCampaign(publicClient: PublicClient, address: Address): Promise<CampaignState> {
  // Every value is read at one block, so a refresh never mixes two moments (for example
  // "allocated" from after a transaction with credits from before it).
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address, abi: fundAbi, functionName: functionName as never, args: args as never, blockNumber }) as Promise<T>;

  const [campaignName, creator, food, shelter, medical, foodPercent, shelterPercent, medicalPercent, endTime, totalDonated, allocated, balance] =
    await Promise.all([
      read<string>("campaignName"),
      read<Address>("creator"),
      read<Address>("foodRecipient"),
      read<Address>("shelterRecipient"),
      read<Address>("medicalRecipient"),
      read<bigint>("foodPercent"),
      read<bigint>("shelterPercent"),
      read<bigint>("medicalPercent"),
      read<bigint>("endTime"),
      read<bigint>("totalDonated"),
      read<boolean>("allocated"),
      publicClient.getBalance({ address, blockNumber }),
    ]);
  const [pendingFood, pendingShelter, pendingMedical] = await Promise.all(
    [food, shelter, medical].map((r) => read<bigint>("pendingWithdrawals", [r])),
  );
  return {
    address,
    campaignName,
    creator,
    recipients: { food, shelter, medical },
    percents: { food: foodPercent, shelter: shelterPercent, medical: medicalPercent },
    endTime,
    totalDonated,
    allocated,
    pending: { food: pendingFood, shelter: pendingShelter, medical: pendingMedical },
    balance,
    chainTime: block.timestamp,
    blockNumber: block.number,
  };
}

/** Is there a DisasterReliefFund at this address? Checks the code exists and answers the getters. */
export async function looksLikeFund(publicClient: PublicClient, address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") return false;
  try {
    await publicClient.readContract({ address, abi: fundAbi, functionName: "endTime" });
    await publicClient.readContract({ address, abi: fundAbi, functionName: "medicalRecipient" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The block a contract was deployed in: the first block whose state holds its code, found by
 * binary search. Needs an endpoint that serves old state; returns null when it does not.
 */
export async function findDeploymentBlock(
  client: Pick<PublicClient, "getBlockNumber" | "getCode">,
  address: Address,
): Promise<bigint | null> {
  try {
    let lo = 0n;
    let hi = await client.getBlockNumber();
    const atTip = await client.getCode({ address, blockNumber: hi });
    if (!atTip || atTip === "0x") return null;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const code = await client.getCode({ address, blockNumber: mid });
      if (code && code !== "0x") hi = mid;
      else lo = mid + 1n;
    }
    return lo;
  } catch {
    return null;
  }
}

/**
 * Every event the contract emitted from `fromBlock` on, oldest first. Long ranges are read in
 * pages, because public Sepolia endpoints cap how many blocks one log query may span.
 */
export async function readEvents(
  publicClient: PublicClient,
  address: Address,
  fromBlock: bigint,
  pageSize = 10_000n,
): Promise<FundEvent[]> {
  const latest = await publicClient.getBlockNumber();
  const out: FundEvent[] = [];
  for (let start = fromBlock; start <= latest; start += pageSize) {
    const end = start + pageSize - 1n < latest ? start + pageSize - 1n : latest;
    const logs = await publicClient.getLogs({ address, fromBlock: start, toBlock: end });
    const parsed = parseEventLogs({ abi: fundAbi, logs });
    for (const log of parsed) {
      const base = { blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
      if (log.eventName === "DonationReceived") out.push({ kind: "donation", donor: log.args.donor, amount: log.args.amount, ...base });
      else if (log.eventName === "FundsAllocated")
        out.push({ kind: "allocation", food: log.args.foodAmount, shelter: log.args.shelterAmount, medical: log.args.medicalAmount, ...base });
      else if (log.eventName === "FundsWithdrawn") out.push({ kind: "withdrawal", recipient: log.args.recipient, amount: log.args.amount, ...base });
    }
  }
  out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return out;
}

/** Adds block times and the allocation caller to events (one request per distinct block or tx). */
export async function enrichEvents(publicClient: PublicClient, events: FundEvent[]): Promise<FundEvent[]> {
  const blockTimes = new Map<bigint, bigint>();
  await Promise.all(
    [...new Set(events.map((e) => e.blockNumber))].map(async (n) => {
      const b = await publicClient.getBlock({ blockNumber: n });
      blockTimes.set(n, b.timestamp);
    }),
  );
  return Promise.all(
    events.map(async (e) => {
      const withTime = { ...e, timestamp: blockTimes.get(e.blockNumber) };
      if (e.kind === "allocation") {
        const tx = await publicClient.getTransaction({ hash: e.txHash });
        return { ...withTime, caller: tx.from } as FundEvent;
      }
      return withTime as FundEvent;
    }),
  );
}

type FundFunction = "donate" | "allocateFunds" | "withdraw";

/** Simulates one of the three functions; only donate() is payable, so only it carries a value. */
function simulate(publicClient: PublicClient, address: Address, account: Address, functionName: FundFunction, value: bigint) {
  return functionName === "donate"
    ? publicClient.simulateContract({ address, abi: fundAbi, functionName, account, value })
    : publicClient.simulateContract({ address, abi: fundAbi, functionName, account });
}

/** Simulates the call; returns null if the contract would accept it, else the contract's reason. */
export async function precheck(
  publicClient: PublicClient,
  address: Address,
  account: Address,
  functionName: FundFunction,
  value = 0n,
): Promise<string | null> {
  try {
    await simulate(publicClient, address, account, functionName, value);
    return null;
  } catch (e) {
    return explainError(e);
  }
}

export async function callFund(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  account: Address,
  functionName: FundFunction,
  value = 0n,
): Promise<TxResult> {
  const { request } = await simulate(publicClient, address, account, functionName, value);
  // The simulated request is one of three shapes; viem's types cannot narrow the union here.
  const hash = await walletClient.writeContract({ ...request, chain: walletClient.chain, account } as never);
  return receiptFor(publicClient, hash, async () => {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    await publicClient.call({
      account,
      to: address,
      data: encodeFunctionData({ abi: fundAbi, functionName }),
      value: functionName === "donate" ? value : undefined,
      blockNumber: receipt.blockNumber,
    });
  });
}

/** A plain sentence for an error from viem, the wallet or the contract. */
export function explainError(e: unknown): string {
  const reason = revertReasonIn(e);
  if (reason) return reason;
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.data?.errorName ?? "The contract rejected the call.";
    }
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in the wallet.";
    const message = e.shortMessage || e.message;
    const revertMatch = /execution reverted:\s*(?:"([^"]+)"|([^\n]+))/i.exec(e.message);
    if (revertMatch && (revertMatch[1] || revertMatch[2])) return (revertMatch[1] ?? revertMatch[2]).trim();
    if (/insufficient funds|enough funds/i.test(`${e.message} ${e.details ?? ""}`)) return "This account does not have enough ETH for the amount plus the gas fee.";
    if (/reverted/i.test(message)) return "The contract reverted without giving a reason.";
    return message;
  }
  if (e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === 4001) return "You rejected the request in the wallet.";
  return e instanceof Error ? e.message : String(e);
}

/** Finds Error(string) revert data anywhere in an error's cause chain and decodes its message. */
function revertReasonIn(e: unknown): string | null {
  let current: unknown = e;
  for (let depth = 0; current && depth < 10; depth++) {
    const data = (current as { data?: unknown }).data;
    const hexData = typeof data === "string" ? data : typeof (data as { data?: unknown })?.data === "string" ? (data as { data: string }).data : null;
    if (hexData && hexData.startsWith("0x4e487b71")) {
      // Panic(uint256): Solidity's built-in checks, such as arithmetic overflow (code 0x11).
      const code = BigInt(`0x${hexData.slice(10) || "0"}`);
      return code === 0x11n ? "Arithmetic overflow: a number is too large for the contract's calculation" : `The contract stopped with Panic code 0x${code.toString(16)}`;
    }
    if (hexData && hexData.startsWith("0x08c379a0")) {
      try {
        const decoded = decodeErrorResult({ abi: [], data: hexData as `0x${string}` });
        if (typeof decoded.args?.[0] === "string") return decoded.args[0];
      } catch {
        // not decodable; keep looking
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
