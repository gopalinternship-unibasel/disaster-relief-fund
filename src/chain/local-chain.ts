// A small Ethereum chain that runs inside the web page, so the app works on any computer with a
// browser and nothing installed, offline too. It executes the contract's real compiled bytecode on
// the Ethereum Foundation's EVM (@ethereumjs/vm) and answers the JSON-RPC requests a node answers,
// so viem talks to it exactly as it talks to Sepolia through MetaMask.
//
// How it behaves:
// - every transaction is mined at once, in a block of its own;
// - when the newest block is 12 seconds old or more, the next request first mines an empty block,
//   so the chain's clock follows the wall clock, like a network with 12-second slots;
// - evm_increaseTime moves the clock forward and evm_mine mines a block at the new time;
// - gas is charged at a fixed base fee of 1 gwei, so a sender's balance falls by the fee;
// - a transaction that would revert is refused before it is mined, with the contract's reason.
// Everything lives in memory: a new chain starts empty.
import { createBlock, type Block } from "@ethereumjs/block";
import { createCustomCommon, Hardfork, Mainnet } from "@ethereumjs/common";
import { createFeeMarket1559Tx } from "@ethereumjs/tx";
import {
  Account,
  bytesToHex,
  createAddressFromPrivateKey,
  createAddressFromString,
  hexToBytes,
} from "@ethereumjs/util";
import { createVM, runTx, type VM } from "@ethereumjs/vm";
import type { Address, Hex } from "viem";
import { DEMO_ACCOUNTS } from "./accounts";

export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_BASE_FEE = 1_000_000_000n; // 1 gwei
export const LOCAL_START_BALANCE = 100n * 10n ** 18n; // 100 ETH per account
export const LOCAL_BLOCK_INTERVAL = 12n; // seconds

const BLOCK_GAS_LIMIT = 30_000_000n;
const MAX_TX_GAS = 15_000_000n; // below the 16,777,216 per-transaction cap (EIP-7825)
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const ZERO_BLOOM = `0x${"00".repeat(256)}` as Hex;
const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;

type Journal = { cleanJournal(): void; addAlwaysWarmAddress(address: string): void };
type RpcRequest = { method: string; params?: unknown[] | Record<string, unknown> };
export type LocalChainProvider = {
  request(args: RpcRequest): Promise<any>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
};

type StoredBlock = { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint; gasUsed: bigint; transactions: Hex[] };
type StoredLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number };
type StoredTx = {
  hash: Hex; from: Address; to: Address | null; value: bigint; input: Hex; nonce: bigint; gas: bigint;
  blockNumber: bigint; blockHash: Hex; gasUsed: bigint; contractAddress: Address | null; logs: StoredLog[];
};
type CallRequest = { from?: string; to?: string | null; data?: string; input?: string; value?: string; gas?: string };

/** An error shaped like a JSON-RPC error, which viem turns into its own error types. */
function rpcError(code: number, message: string, data?: Hex) {
  return Object.assign(new Error(message), { code, data });
}

const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}` as Hex;
const toBig = (value: unknown, fallback = 0n) =>
  value === undefined || value === null || value === "" ? fallback : BigInt(value as string);

/** Gas a transaction pays before any code runs (EIP-2028 calldata prices, EIP-3860 init code). */
function intrinsicGas(data: Uint8Array, isCreate: boolean) {
  let gas = 21_000n;
  for (const byte of data) gas += byte === 0 ? 4n : 16n;
  if (isCreate) gas += 32_000n + 2n * BigInt(Math.ceil(data.length / 32));
  return gas;
}

export type LocalChainOptions = {
  /** Seconds since 1970 that the chain starts at. Defaults to the wall clock. */
  startTime?: bigint;
  /** A clock for tests; defaults to Date.now(). Returns milliseconds. */
  wallClock?: () => number;
  /** Mine an empty block when the newest one is 12 seconds old (default true). Tests turn it off. */
  intervalMining?: boolean;
};

export async function createLocalChain(options: LocalChainOptions = {}): Promise<LocalChainProvider> {
  const common = createCustomCommon({ chainId: LOCAL_CHAIN_ID }, Mainnet, { hardfork: Hardfork.Osaka });
  const vm: VM = await createVM({ common });

  const keys = new Map<string, Uint8Array>();
  for (const account of DEMO_ACCOUNTS) {
    const key = hexToBytes(account.privateKey);
    const address = createAddressFromPrivateKey(key);
    keys.set(address.toString().toLowerCase(), key);
    await vm.stateManager.putAccount(address, new Account(0n, LOCAL_START_BALANCE));
  }

  const wallClock = options.wallClock ?? (() => Date.now());
  const intervalMining = options.intervalMining ?? true;
  const wallSeconds = () => BigInt(Math.floor(wallClock() / 1000));
  // The chain's clock = wall clock + offset. A fixed start time sets the offset at creation.
  let clockOffset = options.startTime !== undefined ? options.startTime - wallSeconds() : 0n;
  const now = () => wallSeconds() + clockOffset;

  const blocks: StoredBlock[] = [];
  const txs = new Map<string, StoredTx>();
  const logs: StoredLog[] = [];
  const createdAt = new Map<string, bigint>(); // contract address (lower case) -> block number

  const makeBlock = (number: bigint, timestamp: bigint, parentHash: Hex): Block =>
    createBlock(
      {
        header: {
          number,
          timestamp,
          parentHash: hexToBytes(parentHash),
          gasLimit: BLOCK_GAS_LIMIT,
          baseFeePerGas: LOCAL_BASE_FEE,
          coinbase: ZERO_ADDRESS,
        },
      },
      { common },
    );

  const genesisTime = now();
  const genesis = makeBlock(0n, genesisTime, ZERO_HASH);
  blocks.push({ number: 0n, hash: bytesToHex(genesis.hash()) as Hex, parentHash: ZERO_HASH, timestamp: genesisTime, gasUsed: 0n, transactions: [] });

  const latest = () => blocks[blocks.length - 1];
  /** The timestamp the next block gets: the clock, but at least one second after the last block. */
  const nextTimestamp = () => (now() > latest().timestamp ? now() : latest().timestamp + 1n);
  const nextBlock = () => {
    const parent = latest();
    const timestamp = nextTimestamp();
    const block = makeBlock(parent.number + 1n, timestamp, parent.hash);
    const stored: StoredBlock = { number: parent.number + 1n, hash: bytesToHex(block.hash()) as Hex, parentHash: parent.hash, timestamp, gasUsed: 0n, transactions: [] };
    return { block, stored };
  };
  const mineEmptyBlock = () => blocks.push(nextBlock().stored);

  const blockByTag = (tag: unknown): StoredBlock | undefined => {
    if (tag === undefined || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") return latest();
    if (tag === "earliest") return blocks[0];
    const n = toBig(tag);
    return n >= 0n && n < BigInt(blocks.length) ? blocks[Number(n)] : undefined;
  };

  const revertError = (returnValue: Uint8Array, reason: string) =>
    rpcError(3, reason === "revert" ? "execution reverted" : `execution reverted: ${reason}`, bytesToHex(returnValue) as Hex);

  /**
   * Runs a call without changing state (eth_call, eth_estimateGas). It runs in the block that
   * would come next, so a deadline check sees the same time a transaction sent now would see.
   */
  async function dryRun(req: CallRequest) {
    const parent = latest();
    const block = makeBlock(parent.number + 1n, nextTimestamp(), parent.hash);
    // runCall keeps the EIP-2929 "already accessed" sets from earlier calls, so a second dry run
    // would pay warm prices and estimate too little gas. Start each one cold, warmed exactly as a
    // real transaction is (precompiles, sender, recipient, coinbase), and clean up afterwards.
    const journal = (vm.evm as unknown as { journal: Journal }).journal;
    const startCold = () => {
      journal.cleanJournal();
      for (const [address] of (vm.evm as unknown as { precompiles: Map<string, unknown> }).precompiles.entries()) journal.addAlwaysWarmAddress(address);
      journal.addAlwaysWarmAddress((req.from ?? ZERO_ADDRESS).slice(2).toLowerCase());
      if (req.to) journal.addAlwaysWarmAddress(req.to.slice(2).toLowerCase());
      journal.addAlwaysWarmAddress(ZERO_ADDRESS.slice(2));
    };
    startCold();
    await vm.stateManager.checkpoint();
    try {
      const result = await vm.evm.runCall({
        caller: createAddressFromString(req.from ?? ZERO_ADDRESS),
        origin: createAddressFromString(req.from ?? ZERO_ADDRESS),
        to: req.to ? createAddressFromString(req.to) : undefined,
        data: hexToBytes((req.data ?? req.input ?? "0x") as Hex),
        value: toBig(req.value),
        gasLimit: toBig(req.gas, MAX_TX_GAS),
        gasPrice: LOCAL_BASE_FEE,
        block,
      });
      const error = result.execResult.exceptionError;
      if (error) throw revertError(result.execResult.returnValue, error.error);
      return result;
    } finally {
      await vm.stateManager.revert();
      journal.cleanJournal();
    }
  }

  async function sendTransaction(req: CallRequest): Promise<Hex> {
    const from = (req.from ?? "").toLowerCase();
    const key = keys.get(from);
    if (!key) throw rpcError(4100, `Account ${req.from ?? "(none)"} is not one of this chain's accounts.`);
    const sender = createAddressFromString(from);
    const nonce = (await vm.stateManager.getAccount(sender))?.nonce ?? 0n;
    const data = hexToBytes((req.data ?? req.input ?? "0x") as Hex);
    const isCreate = !req.to;
    let gasLimit = toBig(req.gas, 0n);
    if (gasLimit === 0n) {
      const trial = await dryRun(req);
      gasLimit = ((trial.execResult.executionGasUsed + intrinsicGas(data, isCreate)) * 13n) / 10n;
    }
    if (gasLimit > MAX_TX_GAS) gasLimit = MAX_TX_GAS;

    const tx = createFeeMarket1559Tx(
      {
        chainId: BigInt(LOCAL_CHAIN_ID),
        nonce,
        maxFeePerGas: LOCAL_BASE_FEE,
        maxPriorityFeePerGas: 0n,
        gasLimit,
        to: isCreate ? undefined : createAddressFromString(req.to as string),
        value: toBig(req.value),
        data,
      },
      { common },
    ).sign(key);

    const { block, stored } = nextBlock();
    await vm.stateManager.checkpoint();
    let result;
    try {
      result = await runTx(vm, { tx, block, skipBlockGasLimitValidation: true });
    } catch (e) {
      await vm.stateManager.revert();
      const message = e instanceof Error ? e.message : String(e);
      throw rpcError(-32000, /insufficient|enough funds|balance/i.test(message) ? "insufficient funds for gas * price + value" : message);
    }
    const error = result.execResult.exceptionError;
    if (error) {
      await vm.stateManager.revert();
      throw revertError(result.execResult.returnValue, error.error);
    }
    await vm.stateManager.commit();

    const hash = bytesToHex(tx.hash()) as Hex;
    const txLogs: StoredLog[] = result.receipt.logs.map(([address, topics, logData], i) => ({
      address: createAddressFromString(bytesToHex(address)).toString() as Address,
      topics: topics.map((t) => bytesToHex(t) as Hex),
      data: bytesToHex(logData) as Hex,
      blockNumber: stored.number,
      blockHash: stored.hash,
      transactionHash: hash,
      logIndex: i,
    }));
    stored.transactions.push(hash);
    stored.gasUsed = result.totalGasSpent;
    blocks.push(stored);
    logs.push(...txLogs);
    txs.set(hash, {
      hash,
      from: sender.toString() as Address,
      to: isCreate ? null : ((req.to as string).toLowerCase() as Address),
      value: toBig(req.value),
      input: bytesToHex(data) as Hex,
      nonce,
      gas: gasLimit,
      blockNumber: stored.number,
      blockHash: stored.hash,
      gasUsed: result.totalGasSpent,
      contractAddress: result.createdAddress ? (result.createdAddress.toString() as Address) : null,
      logs: txLogs,
    });
    if (result.createdAddress) createdAt.set(result.createdAddress.toString().toLowerCase(), stored.number);
    return hash;
  }

  const formatLog = (l: StoredLog) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: hex(l.blockNumber),
    blockHash: l.blockHash,
    transactionHash: l.transactionHash,
    transactionIndex: "0x0",
    logIndex: hex(l.logIndex),
    removed: false,
  });

  const formatTx = (t: StoredTx) => ({
    hash: t.hash, nonce: hex(t.nonce), blockHash: t.blockHash, blockNumber: hex(t.blockNumber), transactionIndex: "0x0",
    from: t.from, to: t.to, value: hex(t.value), gas: hex(t.gas), input: t.input, type: "0x2",
    gasPrice: hex(LOCAL_BASE_FEE), maxFeePerGas: hex(LOCAL_BASE_FEE), maxPriorityFeePerGas: "0x0", chainId: hex(LOCAL_CHAIN_ID),
    accessList: [], v: "0x0", yParity: "0x0", r: "0x0", s: "0x0",
  });

  const formatBlock = (b: StoredBlock, fullTransactions: boolean) => ({
    number: hex(b.number), hash: b.hash, parentHash: b.parentHash, timestamp: hex(b.timestamp),
    gasLimit: hex(BLOCK_GAS_LIMIT), gasUsed: hex(b.gasUsed), baseFeePerGas: hex(LOCAL_BASE_FEE), miner: ZERO_ADDRESS,
    difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", logsBloom: ZERO_BLOOM, nonce: "0x0000000000000000",
    mixHash: ZERO_HASH, sha3Uncles: ZERO_HASH, stateRoot: ZERO_HASH, transactionsRoot: ZERO_HASH, receiptsRoot: ZERO_HASH,
    size: "0x0", uncles: [], withdrawals: [], blobGasUsed: "0x0", excessBlobGas: "0x0",
    transactions: fullTransactions ? b.transactions.map((h) => formatTx(txs.get(h)!)) : b.transactions,
  });

  function getLogs(filter: { address?: string | string[]; topics?: (string | string[] | null)[]; fromBlock?: string; toBlock?: string; blockHash?: string }) {
    let from: bigint, to: bigint;
    if (filter.blockHash) {
      const b = blocks.find((x) => x.hash === filter.blockHash);
      if (!b) return [];
      from = to = b.number;
    } else {
      const fromTag = filter.fromBlock ?? "latest";
      if (typeof fromTag === "string" && fromTag.startsWith("0x") && toBig(fromTag) > latest().number) return [];
      from = blockByTag(fromTag)?.number ?? latest().number;
      to = blockByTag(filter.toBlock ?? "latest")?.number ?? latest().number;
    }
    const addresses = filter.address === undefined ? undefined : [filter.address].flat().map((a) => a.toLowerCase());
    return logs
      .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
      .filter((l) => !addresses || addresses.includes(l.address.toLowerCase()))
      .filter((l) =>
        (filter.topics ?? []).every((wanted, i) => {
          if (wanted === null || wanted === undefined) return true;
          const choices = [wanted].flat().map((t) => t.toLowerCase());
          return l.topics[i] !== undefined && choices.includes(l.topics[i].toLowerCase());
        }),
      )
      .map(formatLog);
  }

  async function handle(method: string, params: unknown[]): Promise<unknown> {
    // Keep the newest block within 12 seconds of the clock, as a live network would.
    if (intervalMining && now() - latest().timestamp >= LOCAL_BLOCK_INTERVAL && method !== "evm_mine") mineEmptyBlock();

    switch (method) {
      case "eth_chainId":
        return hex(LOCAL_CHAIN_ID);
      case "net_version":
        return String(LOCAL_CHAIN_ID);
      case "web3_clientVersion":
        return "relief-fund/in-browser-chain";
      case "eth_accounts":
      case "eth_requestAccounts":
        return DEMO_ACCOUNTS.map((a) => a.address);
      case "eth_blockNumber":
        return hex(latest().number);
      case "eth_gasPrice":
        return hex(LOCAL_BASE_FEE);
      case "eth_maxPriorityFeePerGas":
        return "0x0";
      case "eth_feeHistory":
        return { oldestBlock: hex(latest().number), baseFeePerGas: [hex(LOCAL_BASE_FEE), hex(LOCAL_BASE_FEE)], gasUsedRatio: [0], reward: [["0x0"]] };
      case "eth_getBalance": {
        const account = await vm.stateManager.getAccount(createAddressFromString(params[0] as string));
        return hex(account?.balance ?? 0n);
      }
      case "eth_getTransactionCount": {
        const account = await vm.stateManager.getAccount(createAddressFromString(params[0] as string));
        return hex(account?.nonce ?? 0n);
      }
      case "eth_getCode": {
        // State is kept for the newest block only; a contract simply has no code before its creation.
        const address = (params[0] as string).toLowerCase();
        const at = blockByTag(params[1]);
        const born = createdAt.get(address);
        if (at && born !== undefined && at.number < born) return "0x";
        return bytesToHex(await vm.stateManager.getCode(createAddressFromString(address)));
      }
      case "eth_getBlockByNumber": {
        const b = blockByTag(params[0]);
        return b ? formatBlock(b, Boolean(params[1])) : null;
      }
      case "eth_getBlockByHash": {
        const b = blocks.find((x) => x.hash === params[0]);
        return b ? formatBlock(b, Boolean(params[1])) : null;
      }
      case "eth_call": {
        const result = await dryRun(params[0] as CallRequest);
        return bytesToHex(result.execResult.returnValue);
      }
      case "eth_estimateGas": {
        const req = params[0] as CallRequest;
        const result = await dryRun(req);
        const data = hexToBytes((req.data ?? req.input ?? "0x") as Hex);
        const estimate = ((result.execResult.executionGasUsed + intrinsicGas(data, !req.to)) * 13n) / 10n;
        return hex(estimate < MAX_TX_GAS ? estimate : MAX_TX_GAS);
      }
      case "eth_sendTransaction":
        return sendTransaction(params[0] as CallRequest);
      case "eth_getTransactionByHash": {
        const t = txs.get(String(params[0]).toLowerCase());
        return t ? formatTx(t) : null;
      }
      case "eth_getTransactionReceipt": {
        const t = txs.get(String(params[0]).toLowerCase());
        if (!t) return null;
        return {
          transactionHash: t.hash, transactionIndex: "0x0", blockHash: t.blockHash, blockNumber: hex(t.blockNumber),
          from: t.from, to: t.to, contractAddress: t.contractAddress, cumulativeGasUsed: hex(t.gasUsed), gasUsed: hex(t.gasUsed),
          effectiveGasPrice: hex(LOCAL_BASE_FEE), logs: t.logs.map(formatLog), logsBloom: ZERO_BLOOM, status: "0x1", type: "0x2",
        };
      }
      case "eth_getLogs":
        return getLogs((params[0] ?? {}) as Parameters<typeof getLogs>[0]);
      case "evm_increaseTime": {
        const seconds = typeof params[0] === "number" ? BigInt(params[0]) : toBig(params[0]);
        if (seconds < 0n) throw rpcError(-32602, "evm_increaseTime needs a positive number of seconds");
        clockOffset += seconds;
        return Number(clockOffset);
      }
      case "relief_clock":
        // The chain's clock right now: the time the next block would get.
        return hex(nextTimestamp());
      case "evm_setNextBlockTimestamp": {
        // Sets the clock so the next block gets exactly this timestamp; the clock runs on from there.
        const target = typeof params[0] === "number" ? BigInt(params[0]) : toBig(params[0]);
        if (target <= latest().timestamp) throw rpcError(-32602, "The next block's time must be later than the newest block's time");
        clockOffset = target - wallSeconds();
        return null;
      }
      case "evm_mine":
        mineEmptyBlock();
        return "0x0";
      default:
        throw rpcError(-32601, `The in-browser chain does not support ${method}`);
    }
  }

  // One request at a time, so a read never sees a transaction halfway through.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    request({ method, params }) {
      const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
      const run = queue.then(() => handle(method, args));
      queue = run.catch(() => undefined);
      return run;
    },
    on() {},
    removeListener() {},
  };
}
