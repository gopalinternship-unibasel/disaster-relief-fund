// The build guide's table of important test results (section 15), plus the checks the guide
// mentions elsewhere. Each check runs on its own fresh in-browser chain with the real compiled
// contract, so the results show what the contract does, not what the app expects it to do.
// The app's Test checklist page and the automated tests (npm test) run this same list.
import { formatEther, type Address, type Hash } from "viem";
import {
  fundAbi,
  rejectingRecipientAbi,
  rejectingRecipientBytecode,
  reentrantRecipientAbi,
  reentrantRecipientBytecode,
} from "../contract/artifact";
import { A, createHarness, GUIDE_CONFIG, rejection, type Harness } from "./harness";

export type CheckOutcome = { pass: boolean; actual: string };
export type Check = {
  id: string;
  /** Where the check comes from. */
  source: "Guide table" | "Guide text" | "Security";
  test: string;
  expected: string;
  /** Who sends the transactions, as section 15 asks to record. */
  caller: string;
  run(h: Harness): Promise<CheckOutcome>;
};
export type CheckRun = CheckOutcome & { id: string; txs: Hash[]; ms: number };

const ETH = 10n ** 18n;
const milli = (n: bigint) => (n * ETH) / 1000n; // n thousandths of an ETH
const wei = (n: bigint) => `${n.toString()} wei`;
const quote = (r: string | null) => (r === null ? "accepted" : `rejected with "${r}"`);
const name = (a: Address) => {
  const i = A.findIndex((x) => x.toLowerCase() === a.toLowerCase());
  return i >= 0 ? `Account ${i}` : `${a.slice(0, 6)}…${a.slice(-4)}`;
};
const outcome = (pass: boolean, actual: string): CheckOutcome => ({ pass, actual: actual.charAt(0).toUpperCase() + actual.slice(1) });

async function fundedAndAllocated(h: Harness, amount = milli(10n)) {
  const { address } = await h.deploy();
  await h.donate(address, A[0], amount);
  await h.passDeadline(address);
  await h.allocate(address);
  return address;
}

async function deployHelper(h: Harness, kind: "rejecting" | "reentrant"): Promise<Address> {
  const abi = kind === "rejecting" ? rejectingRecipientAbi : reentrantRecipientAbi;
  const bytecode = kind === "rejecting" ? rejectingRecipientBytecode : reentrantRecipientBytecode;
  const hash = await h.walletClient.deployContract({ abi, bytecode, account: A[0], chain: h.walletClient.chain });
  h.txs.push(hash);
  const receipt = await h.publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress as Address;
}

export const CHECKS: Check[] = [
  {
    id: "valid-deployment",
    source: "Guide table",
    test: "Valid deployment",
    expected: "Correct creator, wallets and shares; total 0; allocated false",
    caller: "Account 0 deploys",
    async run(h) {
      const { address, blockNumber } = await h.deploy();
      const s = await h.read(address);
      const deployedAt = (await h.publicClient.getBlock({ blockNumber })).timestamp;
      const pass =
        s.creator === A[0] &&
        s.recipients.food === A[1] && s.recipients.shelter === A[2] && s.recipients.medical === A[3] &&
        s.percents.food === 40n && s.percents.shelter === 35n && s.percents.medical === 25n &&
        s.endTime === deployedAt + 600n &&
        s.totalDonated === 0n && s.allocated === false &&
        s.pending.food === 0n && s.pending.shelter === 0n && s.pending.medical === 0n &&
        s.campaignName === GUIDE_CONFIG.campaignName;
      return outcome(
        pass,
        `creator ${name(s.creator)}, recipients ${name(s.recipients.food)} / ${name(s.recipients.shelter)} / ${name(s.recipients.medical)}, shares ${s.percents.food}/${s.percents.shelter}/${s.percents.medical}, endTime = deployment time + ${s.endTime - deployedAt} s, total ${s.totalDonated}, allocated ${s.allocated}, credits ${s.pending.food}/${s.pending.shelter}/${s.pending.medical}`,
      );
    },
  },
  {
    id: "duration-zero",
    source: "Guide table",
    test: "Duration 0",
    expected: "Deployment rejected",
    caller: "Account 0 deploys",
    async run(h) {
      const r = await rejection(() => h.deploy({ durationMinutes: 0n }));
      return outcome(r === "Duration must be positive", quote(r));
    },
  },
  {
    id: "zero-recipient",
    source: "Guide table",
    test: "Any zero recipient address",
    expected: "Deployment rejected",
    caller: "Account 0 deploys",
    async run(h) {
      const zero = "0x0000000000000000000000000000000000000000" as Address;
      const results = [
        await rejection(() => h.deploy({ foodRecipient: zero })),
        await rejection(() => h.deploy({ shelterRecipient: zero })),
        await rejection(() => h.deploy({ medicalRecipient: zero })),
      ];
      return outcome(results.every((r) => r === "Zero recipient"), `zero food, shelter or medical address: ${results.map(quote).join(" / ")}`);
    },
  },
  {
    id: "equal-recipients",
    source: "Guide table",
    test: "Two recipient addresses equal",
    expected: "Deployment rejected",
    caller: "Account 0 deploys",
    async run(h) {
      const results = [
        await rejection(() => h.deploy({ shelterRecipient: A[1] })),
        await rejection(() => h.deploy({ medicalRecipient: A[1] })),
        await rejection(() => h.deploy({ medicalRecipient: A[2] })),
      ];
      return outcome(results.every((r) => r === "Recipients must differ"), `all three pairs: ${results.map(quote).join(" / ")}`);
    },
  },
  {
    id: "zero-percent",
    source: "Guide table",
    test: "Any percentage 0, even if sum is 100",
    expected: "Deployment rejected",
    caller: "Account 0 deploys",
    async run(h) {
      const results = [
        await rejection(() => h.deploy({ foodPercent: 0n, shelterPercent: 50n, medicalPercent: 50n })),
        await rejection(() => h.deploy({ foodPercent: 50n, shelterPercent: 0n, medicalPercent: 50n })),
        await rejection(() => h.deploy({ foodPercent: 50n, shelterPercent: 50n, medicalPercent: 0n })),
      ];
      return outcome(results.every((r) => r === "Percentages must be positive"), `0/50/50, 50/0/50, 50/50/0: ${results.map(quote).join(" / ")}`);
    },
  },
  {
    id: "sum-not-100",
    source: "Guide table",
    test: "Percentages 40/35/24 or 40/35/26",
    expected: "Deployment rejected because sum is not 100",
    caller: "Account 0 deploys",
    async run(h) {
      const results = [
        await rejection(() => h.deploy({ medicalPercent: 24n })),
        await rejection(() => h.deploy({ medicalPercent: 26n })),
      ];
      return outcome(results.every((r) => r === "Percentages must total 100"), `40/35/24 ${quote(results[0])}; 40/35/26 ${quote(results[1])}`);
    },
  },
  {
    id: "positive-donation",
    source: "Guide table",
    test: "Positive donation before deadline",
    expected: "Total increases and DonationReceived records caller and amount",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      const tx = await h.donate(address, A[0], milli(4n));
      const s = await h.read(address);
      const events = await h.events(tx.hash);
      const e = events.find((x) => x.eventName === "DonationReceived");
      const ok = e?.eventName === "DonationReceived" && e.args.donor === A[0] && e.args.amount === milli(4n);
      return outcome(
        s.totalDonated === milli(4n) && Boolean(ok),
        e?.eventName === "DonationReceived"
          ? `totalDonated ${wei(s.totalDonated)}; DonationReceived(donor ${name(e.args.donor)}, ${wei(e.args.amount)})`
          : `totalDonated ${wei(s.totalDonated)}; no DonationReceived event`,
      );
    },
  },
  {
    id: "donor-twice",
    source: "Guide table",
    test: "Same donor contributes twice",
    expected: "Amounts accumulate",
    caller: "Account 0, twice",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(4n));
      await h.donate(address, A[0], milli(6n));
      const s = await h.read(address);
      return outcome(s.totalDonated === milli(10n), `0.004 + 0.006 ETH gives totalDonated ${wei(s.totalDonated)} (${formatEther(s.totalDonated)} ETH)`);
    },
  },
  {
    id: "zero-donation",
    source: "Guide table",
    test: "Zero donation before deadline",
    expected: "Rejected",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      const r = await rejection(() => h.donate(address, A[0], 0n));
      return outcome(r === "Donation must be positive", quote(r));
    },
  },
  {
    id: "allocate-early",
    source: "Guide table",
    test: "Allocation before deadline",
    expected: "Rejected",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(4n));
      const r = await rejection(() => h.allocate(address));
      return outcome(r === "Fundraising still open", quote(r));
    },
  },
  {
    id: "withdraw-before-allocation",
    source: "Guide table",
    test: "Withdrawal before allocation",
    expected: "Rejected, including after the deadline",
    caller: "Account 1",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(4n));
      const before = await rejection(() => h.withdraw(address, A[1]));
      await h.passDeadline(address);
      const after = await rejection(() => h.withdraw(address, A[1]));
      return outcome(
        before === "Funds not allocated" && after === "Funds not allocated",
        `before the deadline ${quote(before)}; after it ${quote(after)}`,
      );
    },
  },
  {
    id: "valid-allocation",
    source: "Guide table",
    test: "Valid allocation after deadline",
    expected: "Three credits recorded; no recipient paid yet",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(10n));
      await h.passDeadline(address);
      const balancesBefore = await Promise.all([A[1], A[2], A[3]].map((a) => h.balance(a)));
      await h.allocate(address);
      const balancesAfter = await Promise.all([A[1], A[2], A[3]].map((a) => h.balance(a)));
      const s = await h.read(address);
      const unpaid = balancesBefore.every((b, i) => b === balancesAfter[i]);
      const pass = s.allocated && s.pending.food === milli(4n) && s.pending.shelter === 3_500_000_000_000_000n && s.pending.medical === 2_500_000_000_000_000n && unpaid && s.balance === milli(10n);
      return outcome(
        pass,
        `credits ${s.pending.food} / ${s.pending.shelter} / ${s.pending.medical} wei; recipient balances ${unpaid ? "unchanged" : "changed"}; contract still holds ${formatEther(s.balance)} ETH`,
      );
    },
  },
  {
    id: "another-allocator",
    source: "Guide table",
    test: "Another account allocates",
    expected: "Same preset credits for the same addresses",
    caller: "Account 5",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(10n));
      await h.passDeadline(address);
      await h.allocate(address, A[5]);
      const s = await h.read(address);
      const pass = s.pending.food === milli(4n) && s.pending.shelter === 3_500_000_000_000_000n && s.pending.medical === 2_500_000_000_000_000n;
      const callerCredit = await h.publicClient.readContract({ address, abi: fundAbi, functionName: "pendingWithdrawals", args: [A[5]] });
      return outcome(pass && callerCredit === 0n, `allocated by Account 5: credits ${s.pending.food} / ${s.pending.shelter} / ${s.pending.medical} wei; the caller's own credit ${callerCredit}`);
    },
  },
  {
    id: "repeat-allocation",
    source: "Guide table",
    test: "Repeated allocation",
    expected: "Rejected",
    caller: "Account 0",
    async run(h) {
      const address = await fundedAndAllocated(h);
      const r = await rejection(() => h.allocate(address));
      return outcome(r === "Already allocated", quote(r));
    },
  },
  {
    id: "donate-at-deadline",
    source: "Guide table",
    test: "Donation at or after deadline",
    expected: "Rejected",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      const { endTime } = await h.read(address);
      await h.setNextBlockTime(endTime); // the next block lands exactly on endTime
      const atDeadline = await rejection(() => h.donate(address, A[0], milli(1n)));
      await h.passDeadline(address, 60n);
      const after = await rejection(() => h.donate(address, A[0], milli(1n)));
      return outcome(
        atDeadline === "Fundraising ended" && after === "Fundraising ended",
        `at exactly endTime ${quote(atDeadline)}; one minute later ${quote(after)}`,
      );
    },
  },
  {
    id: "unrelated-withdraw",
    source: "Guide table",
    test: "Unrelated wallet withdraws after allocation",
    expected: "Rejected with Nothing to withdraw",
    caller: "Account 0, then Account 5",
    async run(h) {
      const address = await fundedAndAllocated(h);
      const organizer = await rejection(() => h.withdraw(address, A[0]));
      const unrelated = await rejection(() => h.withdraw(address, A[5]));
      return outcome(
        organizer === "Nothing to withdraw" && unrelated === "Nothing to withdraw",
        `organizer ${quote(organizer)}; Account 5 ${quote(unrelated)}`,
      );
    },
  },
  {
    id: "recipient-withdraws",
    source: "Guide table",
    test: "Recipient withdraws",
    expected: "Its credit becomes 0 and its payment event appears",
    caller: "Account 1",
    async run(h) {
      const address = await fundedAndAllocated(h);
      const before = await h.balance(A[1]);
      const tx = await h.withdraw(address, A[1]);
      const after = await h.balance(A[1]);
      const s = await h.read(address);
      const e = (await h.events(tx.hash)).find((x) => x.eventName === "FundsWithdrawn");
      const eventOk = e?.eventName === "FundsWithdrawn" && e.args.recipient === A[1] && e.args.amount === milli(4n);
      const netOk = after - before === milli(4n) - tx.fee;
      return outcome(
        s.pending.food === 0n && eventOk && netOk,
        `food credit now ${s.pending.food}; ${e?.eventName === "FundsWithdrawn" ? `FundsWithdrawn(${name(e.args.recipient)}, ${wei(e.args.amount)})` : "no FundsWithdrawn event"}; wallet changed by ${formatEther(after - before)} ETH = credit ${formatEther(milli(4n))} minus gas fee ${formatEther(tx.fee)}${netOk ? "" : " (does not add up)"}`,
      );
    },
  },
  {
    id: "withdraw-twice",
    source: "Guide table",
    test: "Same recipient withdraws again",
    expected: "Rejected; other recipients keep their credits",
    caller: "Account 1",
    async run(h) {
      const address = await fundedAndAllocated(h);
      await h.withdraw(address, A[1]);
      const r = await rejection(() => h.withdraw(address, A[1]));
      const s = await h.read(address);
      const pass = r === "Nothing to withdraw" && s.pending.shelter === 3_500_000_000_000_000n && s.pending.medical === 2_500_000_000_000_000n;
      return outcome(pass, `second claim ${quote(r)}; shelter ${s.pending.shelter} wei and medical ${s.pending.medical} wei still credited`);
    },
  },
  {
    id: "rounding-101",
    source: "Guide table",
    test: "101 wei, 40/35/25 campaign",
    expected: "Credits are 40, 35 and 26 wei",
    caller: "Account 0 donates and allocates",
    async run(h) {
      const address = await fundedAndAllocated(h, 101n);
      const s = await h.read(address);
      return outcome(
        s.pending.food === 40n && s.pending.shelter === 35n && s.pending.medical === 26n,
        `credits ${s.pending.food}, ${s.pending.shelter} and ${s.pending.medical} wei`,
      );
    },
  },
  {
    id: "empty-campaign",
    source: "Guide table",
    test: "No donations by deadline",
    expected: "Allocation succeeds with zero credits; withdrawals are rejected",
    caller: "Account 0 allocates; Accounts 1 to 3 try to withdraw",
    async run(h) {
      const { address } = await h.deploy();
      await h.passDeadline(address);
      const alloc = await rejection(() => h.allocate(address));
      const s = await h.read(address);
      const ws = [await rejection(() => h.withdraw(address, A[1])), await rejection(() => h.withdraw(address, A[2])), await rejection(() => h.withdraw(address, A[3]))];
      const pass = alloc === null && s.allocated && s.pending.food === 0n && s.pending.shelter === 0n && s.pending.medical === 0n && ws.every((w) => w === "Nothing to withdraw");
      return outcome(pass, `allocation ${quote(alloc)}, credits ${s.pending.food}/${s.pending.shelter}/${s.pending.medical}; withdrawals by the three recipients ${ws.map(quote).join(" / ")}`);
    },
  },
  {
    id: "other-proportions",
    source: "Guide text",
    test: "60/25/15 campaign, 10000 wei donated",
    expected: "Credits are 6000, 2500 and 1500 wei",
    caller: "Account 0 deploys, donates and allocates",
    async run(h) {
      const { address } = await h.deploy({ foodPercent: 60n, shelterPercent: 25n, medicalPercent: 15n });
      await h.donate(address, A[0], 10_000n);
      await h.passDeadline(address);
      await h.allocate(address);
      const s = await h.read(address);
      return outcome(
        s.pending.food === 6000n && s.pending.shelter === 2500n && s.pending.medical === 1500n,
        `credits ${s.pending.food}, ${s.pending.shelter} and ${s.pending.medical} wei`,
      );
    },
  },
  {
    id: "allocate-at-deadline",
    source: "Guide text",
    test: "Allocation at exactly the deadline",
    expected: "Accepted: donate() needs before endTime, allocateFunds() allows at endTime",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], milli(1n));
      const { endTime } = await h.read(address);
      await h.setNextBlockTime(endTime);
      const r = await rejection(() => h.allocate(address));
      const block = await h.publicClient.getBlock({ blockTag: "latest" });
      return outcome(r === null && block.timestamp === endTime, `allocation in the block at endTime ${quote(r)} (block time minus endTime: ${block.timestamp - endTime} s)`);
    },
  },
  {
    id: "guide-walkthrough",
    source: "Guide text",
    test: "Sections 12 to 14 walkthrough: 0.004 + 0.006 ETH, then three claims",
    expected: "Credits 0.004 / 0.0035 / 0.0025 ETH; 0.006 ETH left after the food claim, 0 after all three; total stays 0.01 ETH",
    caller: "Account 0 donates and allocates; Accounts 1 to 3 withdraw",
    async run(h) {
      const { address } = await h.deploy();
      await h.donate(address, A[0], 4_000_000_000_000_000n);
      await h.donate(address, A[0], 6_000_000_000_000_000n);
      await h.passDeadline(address);
      await h.allocate(address);
      const credited = await h.read(address);
      await h.withdraw(address, A[1]);
      const afterFood = await h.balance(address);
      await h.withdraw(address, A[2]);
      await h.withdraw(address, A[3]);
      const s = await h.read(address);
      const creditsOk = credited.pending.food === milli(4n) && credited.pending.shelter === 3_500_000_000_000_000n && credited.pending.medical === 2_500_000_000_000_000n;
      const clearedOk = s.pending.food === 0n && s.pending.shelter === 0n && s.pending.medical === 0n;
      const pass = creditsOk && clearedOk && afterFood === milli(6n) && s.balance === 0n && s.totalDonated === milli(10n);
      return outcome(
        pass,
        `credits ${formatEther(credited.pending.food)} / ${formatEther(credited.pending.shelter)} / ${formatEther(credited.pending.medical)} ETH; after the food claim the contract holds ${formatEther(afterFood)} ETH; after all three ${formatEther(s.balance)} ETH with credits ${s.pending.food}/${s.pending.shelter}/${s.pending.medical}; totalDonated ${formatEther(s.totalDonated)} ETH`,
      );
    },
  },
  {
    id: "rounding-33-33-34",
    source: "Guide text",
    test: "101 wei, 33/33/34 campaign",
    expected: "Credits are 33, 33 and 35 wei",
    caller: "Account 0 deploys, donates and allocates",
    async run(h) {
      const { address } = await h.deploy({ foodPercent: 33n, shelterPercent: 33n, medicalPercent: 34n });
      await h.donate(address, A[0], 101n);
      await h.passDeadline(address);
      await h.allocate(address);
      const s = await h.read(address);
      return outcome(
        s.pending.food === 33n && s.pending.shelter === 33n && s.pending.medical === 35n,
        `credits ${s.pending.food}, ${s.pending.shelter} and ${s.pending.medical} wei`,
      );
    },
  },
  {
    id: "plain-transfer",
    source: "Guide text",
    test: "Plain ETH transfer to the contract, without donate()",
    expected: "Rejected: the contract has no receive or fallback function",
    caller: "Account 0",
    async run(h) {
      const { address } = await h.deploy();
      const r = await rejection(() => h.walletClient.sendTransaction({ account: A[0], to: address, value: milli(1n), chain: h.walletClient.chain }));
      const s = await h.read(address);
      return outcome(
        r !== null && s.balance === 0n && s.totalDonated === 0n,
        `transfer ${r === null ? "accepted" : `rejected (${r})`}; contract balance ${formatEther(s.balance)} ETH, totalDonated ${s.totalDonated}`,
      );
    },
  },
  {
    id: "failed-payment",
    source: "Security",
    test: "A recipient that refuses ETH tries to withdraw",
    expected: "The withdrawal reverts, its credit is restored, other recipients still withdraw",
    caller: "A recipient contract, called from Account 0; then Account 2",
    async run(h) {
      const helper = await deployHelper(h, "rejecting");
      const { address } = await h.deploy({ foodRecipient: helper });
      await h.donate(address, A[0], milli(10n));
      await h.passDeadline(address);
      await h.allocate(address);
      const r = await rejection(async () => {
        const { request } = await h.publicClient.simulateContract({ address: helper, abi: rejectingRecipientAbi, functionName: "claim", args: [address], account: A[0] });
        await h.walletClient.writeContract({ ...request, chain: h.walletClient.chain, account: A[0] });
      });
      const s = await h.read(address);
      await h.withdraw(address, A[2]);
      const after = await h.read(address);
      const pass = r === "ETH transfer failed" && s.pending.food === milli(4n) && after.pending.shelter === 0n;
      return outcome(pass, `claim ${quote(r)}; food credit still ${s.pending.food} wei; shelter then withdrew, its credit now ${after.pending.shelter}`);
    },
  },
  {
    id: "reentrancy",
    source: "Security",
    test: "A recipient contract calls withdraw() again while being paid",
    expected: "The inner call fails with Nothing to withdraw; the recipient is paid once",
    caller: "A recipient contract, called from Account 0",
    async run(h) {
      const helper = await deployHelper(h, "reentrant");
      const { address } = await h.deploy({ foodRecipient: helper });
      await h.donate(address, A[0], milli(10n));
      await h.passDeadline(address);
      await h.allocate(address);
      const { request } = await h.publicClient.simulateContract({ address: helper, abi: reentrantRecipientAbi, functionName: "claim", args: [address], account: A[0] });
      const hash = await h.walletClient.writeContract({ ...request, chain: h.walletClient.chain, account: A[0] });
      h.txs.push(hash);
      await h.publicClient.waitForTransactionReceipt({ hash });
      const read = (functionName: "timesPaid" | "reentryFailed" | "reentryReason") =>
        h.publicClient.readContract({ address: helper, abi: reentrantRecipientAbi, functionName });
      const [timesPaid, failed, reason] = await Promise.all([read("timesPaid"), read("reentryFailed"), read("reentryReason")]);
      const helperBalance = await h.balance(helper);
      const s = await h.read(address);
      const pass = timesPaid === 1n && failed === true && reason === "Nothing to withdraw" && helperBalance === milli(4n) && s.balance === milli(6n);
      return outcome(pass, `paid ${timesPaid} time; inner call ${failed ? `failed with "${reason}"` : "succeeded"}; recipient received ${formatEther(helperBalance)} ETH; contract holds ${formatEther(s.balance)} ETH`);
    },
  },
];

export async function runCheck(check: Check, bytecode?: `0x${string}`): Promise<CheckRun> {
  const started = performance.now();
  const h = await createHarness(bytecode);
  try {
    const result = await check.run(h);
    return { ...result, id: check.id, txs: [...h.txs], ms: performance.now() - started };
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { pass: false, actual: `The check stopped: ${message}`, id: check.id, txs: [...h.txs], ms: performance.now() - started };
  }
}
