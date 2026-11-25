// A fresh in-browser chain with a frozen clock, for running one check at a time. The clock moves
// only when a check moves it, so deadline tests land on exact seconds.
import { parseEventLogs, type Address, type Hash } from "viem";
import { DEMO_ACCOUNTS } from "../chain/accounts";
import { clientsFor, localChain } from "../chain/clients";
import { createLocalChain } from "../chain/local-chain";
import { fundAbi } from "../contract/artifact";
import { callFund, deployFund, explainError, readCampaign, type DeployArgs, type TxResult } from "../contract/fund";

export const A = DEMO_ACCOUNTS.map((a) => a.address);

export const GUIDE_CONFIG: DeployArgs = {
  campaignName: "Flood relief simulation",
  foodRecipient: A[1],
  shelterRecipient: A[2],
  medicalRecipient: A[3],
  durationMinutes: 10n,
  foodPercent: 40n,
  shelterPercent: 35n,
  medicalPercent: 25n,
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** `bytecode` lets the mutation tests run the checks against deliberately broken contracts. */
export async function createHarness(bytecode?: `0x${string}`) {
  const start = 1_800_000_000n; // a fixed start time keeps every run identical
  const frozenMs = Number(start) * 1000;
  const provider = await createLocalChain({ startTime: start, wallClock: () => frozenMs, intervalMining: false });
  const { publicClient, walletClient } = clientsFor(provider, localChain);
  const txs: Hash[] = [];

  const record = <T extends TxResult>(r: T) => {
    txs.push(r.hash);
    return r;
  };

  return {
    provider,
    publicClient,
    walletClient,
    txs,
    async deploy(overrides: Partial<DeployArgs> = {}, from: Address = A[0]) {
      return record(await deployFund(walletClient, publicClient, from, { ...GUIDE_CONFIG, ...overrides }, bytecode));
    },
    async donate(fund: Address, from: Address, value: bigint) {
      return record(await callFund(walletClient, publicClient, fund, from, "donate", value));
    },
    async allocate(fund: Address, from: Address = A[0]) {
      return record(await callFund(walletClient, publicClient, fund, from, "allocateFunds"));
    },
    async withdraw(fund: Address, from: Address) {
      return record(await callFund(walletClient, publicClient, fund, from, "withdraw"));
    },
    read: (fund: Address) => readCampaign(publicClient, fund),
    balance: (address: Address) => publicClient.getBalance({ address }),
    /** Moves the clock so the next block's timestamp is exactly `timestamp`. */
    async setNextBlockTime(timestamp: bigint) {
      await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] });
    },
    /** Moves the clock past the deadline and mines a block there. */
    async passDeadline(fund: Address, extraSeconds = 0n) {
      const { endTime } = await readCampaign(publicClient, fund);
      await this.setNextBlockTime(endTime + extraSeconds);
      await provider.request({ method: "evm_mine", params: [] });
    },
    async events(hash: Hash) {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      return parseEventLogs({ abi: fundAbi, logs: receipt.logs });
    },
  };
}

/** Runs `action`; returns the contract's reason if it was rejected, or null if it succeeded. */
export async function rejection(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (e) {
    return explainError(e);
  }
}
