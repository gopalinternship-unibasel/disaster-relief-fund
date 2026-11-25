// Tests of the in-browser chain itself: accounts, clock, gas and error reporting.
import { encodeFunctionData, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS } from "../src/chain/accounts";
import { clientsFor, localChain } from "../src/chain/clients";
import { createLocalChain, LOCAL_BASE_FEE, LOCAL_START_BALANCE } from "../src/chain/local-chain";
import { A, createHarness } from "../src/checks/harness";
import { fundAbi } from "../src/contract/artifact";
import { callFund, explainError, findDeploymentBlock, precheck, readEvents, splitTotal } from "../src/contract/fund";

describe("in-browser chain", () => {
  it("each demo account's published key belongs to its address", () => {
    for (const a of DEMO_ACCOUNTS) expect(privateKeyToAccount(a.privateKey).address).toBe(a.address);
  });

  it("starts every account with 100 ETH and charges gas at 1 gwei", async () => {
    const h = await createHarness();
    expect(await h.balance(A[4])).toBe(LOCAL_START_BALANCE);
    const { address } = await h.deploy();
    const tx = await h.donate(address, A[4], parseEther("0.5"));
    expect(tx.fee).toBe(tx.gasUsed * LOCAL_BASE_FEE);
    expect(tx.gasUsed).toBeGreaterThan(21_000n);
    expect(await h.balance(A[4])).toBe(LOCAL_START_BALANCE - parseEther("0.5") - tx.fee);
  });

  it("follows the wall clock and mines an empty block every 12 seconds", async () => {
    let ms = 1_900_000_000_000;
    const provider = await createLocalChain({ wallClock: () => ms });
    const { publicClient } = clientsFor(provider, localChain);
    const first = await publicClient.getBlock({ blockTag: "latest" });
    expect(first.timestamp).toBe(1_900_000_000n);
    ms += 11_000;
    expect((await publicClient.getBlock({ blockTag: "latest" })).number).toBe(first.number);
    ms += 1_000;
    const later = await publicClient.getBlock({ blockTag: "latest" });
    expect(later.number).toBe(first.number + 1n);
    expect(later.timestamp).toBe(1_900_000_012n);
  });

  it("estimates the same gas on repeated dry runs, and the estimate covers the real transaction", async () => {
    const h = await createHarness();
    const { address } = await h.deploy();
    const data = encodeFunctionData({ abi: fundAbi, functionName: "donate" });
    const first = await h.publicClient.estimateGas({ account: A[0], to: address, data, value: 1000n });
    const second = await h.publicClient.estimateGas({ account: A[0], to: address, data, value: 1000n });
    expect(second).toBe(first);
    const tx = await h.donate(address, A[0], 1000n);
    expect(first).toBeGreaterThanOrEqual(tx.gasUsed);
  });

  it("evm_increaseTime moves the clock and evm_mine records it", async () => {
    const provider = await createLocalChain({ wallClock: () => 1_900_000_000_000 });
    const { publicClient } = clientsFor(provider, localChain);
    await provider.request({ method: "evm_increaseTime", params: [600] });
    await provider.request({ method: "evm_mine", params: [] });
    expect((await publicClient.getBlock({ blockTag: "latest" })).timestamp).toBe(1_900_000_600n);
  });

  it("refuses a reverting transaction without mining it and reports the contract's reason", async () => {
    const h = await createHarness();
    const { address } = await h.deploy();
    const before = await h.publicClient.getBlockNumber();
    const hash = await h.walletClient
      .sendTransaction({ account: A[0], to: address, data: encodeFunctionData({ abi: fundAbi, functionName: "allocateFunds" }), gas: 200_000n, chain: localChain })
      .catch((e) => e);
    expect(explainError(hash)).toBe("Fundraising still open");
    expect(await h.publicClient.getBlockNumber()).toBe(before);
  });

  it("precheck names the reason before anything is sent", async () => {
    const h = await createHarness();
    const { address } = await h.deploy();
    expect(await precheck(h.publicClient, address, A[1], "withdraw")).toBe("Funds not allocated");
    expect(await precheck(h.publicClient, address, A[0], "donate", 0n)).toBe("Donation must be positive");
    expect(await precheck(h.publicClient, address, A[0], "donate", 1n)).toBeNull();
  });

  it("reads the events back in order with their amounts", async () => {
    const h = await createHarness();
    const { address, blockNumber } = await h.deploy();
    await h.donate(address, A[0], parseEther("0.004"));
    await h.donate(address, A[4], parseEther("0.006"));
    await h.passDeadline(address);
    await callFund(h.walletClient, h.publicClient, address, A[0], "allocateFunds");
    await h.withdraw(address, A[1]);
    const events = await readEvents(h.publicClient, address, blockNumber, 2n); // tiny pages exercise the paging
    expect(events.map((e) => e.kind)).toEqual(["donation", "donation", "allocation", "withdrawal"]);
    const alloc = events[2];
    expect(alloc.kind === "allocation" && formatEther(alloc.shelter)).toBe("0.0035");
  });

  it("finds a deployment block by binary search, and gives up when old state is missing", async () => {
    const deployedAt = 7_654_321n;
    const archive = {
      getBlockNumber: async () => 12_000_000n,
      getCode: async ({ blockNumber }: { blockNumber?: bigint }) => ((blockNumber ?? 0n) >= deployedAt ? "0x6080" : "0x"),
    };
    expect(await findDeploymentBlock(archive as never, "0x5FbDB2315678afecb367f032d93F642f64180aa3")).toBe(deployedAt);
    const pruned = { getBlockNumber: async () => 100n, getCode: async ({ blockNumber }: { blockNumber?: bigint }) => { if (blockNumber !== 100n) throw new Error("missing trie node"); return "0x6080"; } };
    expect(await findDeploymentBlock(pruned as never, "0x5FbDB2315678afecb367f032d93F642f64180aa3")).toBeNull();
  });

  it("splitTotal matches the contract's arithmetic", () => {
    expect(splitTotal(101n, 40n, 35n)).toEqual({ food: 40n, shelter: 35n, medical: 26n });
    expect(splitTotal(101n, 33n, 33n)).toEqual({ food: 33n, shelter: 33n, medical: 35n });
    expect(splitTotal(parseEther("0.01"), 40n, 35n)).toEqual({ food: parseEther("0.004"), shelter: parseEther("0.0035"), medical: parseEther("0.0025") });
  });
});
