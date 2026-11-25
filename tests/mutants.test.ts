// Mutation tests: each case breaks the contract in one small way, compiles the broken copy with the
// same settings, and confirms that the check meant to catch that mistake now fails. A check that
// passes on a broken contract would be worthless, so this is the test of the tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";
import { describe, expect, it } from "vitest";
import { CHECKS, runCheck } from "../src/checks/guide-checks";

const source = readFileSync(path.join(__dirname, "..", "contracts", "DisasterReliefFund.sol"), "utf8").replace(/\r\n/g, "\n");

function compile(text: string): `0x${string}` {
  const input = {
    language: "Solidity",
    sources: { "DisasterReliefFund.sol": { content: text } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  return `0x${out.contracts["DisasterReliefFund.sol"].DisasterReliefFund.evm.bytecode.object}`;
}

type Mutant = { name: string; from: string; to: string; caughtBy: string };

const MUTANTS: Mutant[] = [
  { name: "donations allowed at the deadline (< becomes <=)", from: 'block.timestamp < endTime, "Fundraising ended"', to: 'block.timestamp <= endTime, "Fundraising ended"', caughtBy: "donate-at-deadline" },
  { name: "allocation refused at the deadline (>= becomes >)", from: 'block.timestamp >= endTime, "Fundraising still open"', to: 'block.timestamp > endTime, "Fundraising still open"', caughtBy: "allocate-at-deadline" },
  { name: "allocation allowed before the deadline", from: 'require(block.timestamp >= endTime, "Fundraising still open");', to: "", caughtBy: "allocate-early" },
  { name: "credit cleared after the payment instead of before", from: "pendingWithdrawals[msg.sender] = 0;\n        (bool sent, ) = payable(msg.sender).call{value: amount}(\"\");", to: "(bool sent, ) = payable(msg.sender).call{value: amount}(\"\");\n        pendingWithdrawals[msg.sender] = 0;", caughtBy: "reentrancy" },
  { name: "payment result ignored", from: 'require(sent, "ETH transfer failed");', to: "sent;", caughtBy: "failed-payment" },
  { name: "medical share rounded down instead of taking the remainder", from: "uint medicalAmount = totalDonated - foodAmount - shelterAmount;", to: "uint medicalAmount = totalDonated * medicalPercent / 100;", caughtBy: "rounding-101" },
  { name: "repeat allocation not blocked", from: 'require(!allocated, "Already allocated");', to: "", caughtBy: "repeat-allocation" },
  { name: "allocated flag never set", from: "allocated = true;", to: "", caughtBy: "repeat-allocation" },
  { name: "donations overwrite the total", from: "totalDonated += msg.value;", to: "totalDonated = msg.value;", caughtBy: "donor-twice" },
  { name: "zero donations accepted", from: 'require(msg.value > 0, "Donation must be positive");', to: "", caughtBy: "zero-donation" },
  { name: "withdraw does not wait for allocation", from: 'require(allocated, "Funds not allocated");', to: "", caughtBy: "withdraw-before-allocation" },
  { name: "zero recipient accepted", from: "_foodRecipient != address(0) &&\n            _shelterRecipient != address(0) &&\n            _medicalRecipient != address(0)", to: "true", caughtBy: "zero-recipient" },
  { name: "recipients may be equal", from: "_foodRecipient != _shelterRecipient &&\n            _foodRecipient != _medicalRecipient &&\n            _shelterRecipient != _medicalRecipient", to: "true", caughtBy: "equal-recipients" },
  { name: "zero percentages accepted", from: "_foodPercent > 0 && _shelterPercent > 0 &&\n            _medicalPercent > 0", to: "true", caughtBy: "zero-percent" },
  { name: "percentages may total less than 100", from: "_foodPercent + _shelterPercent + _medicalPercent == 100", to: "_foodPercent + _shelterPercent + _medicalPercent <= 100", caughtBy: "sum-not-100" },
  { name: "deadline counted in seconds instead of minutes", from: "_durationMinutes * 1 minutes", to: "_durationMinutes * 1 seconds", caughtBy: "valid-deployment" },
  { name: "zero duration accepted", from: 'require(_durationMinutes > 0, "Duration must be positive");', to: "", caughtBy: "duration-zero" },
  { name: "creator set to the food recipient", from: "creator = msg.sender;", to: "creator = _foodRecipient;", caughtBy: "valid-deployment" },
  { name: "food credit never recorded", from: "pendingWithdrawals[foodRecipient] = foodAmount;", to: "", caughtBy: "valid-allocation" },
  { name: "shelter credit given to the caller", from: "pendingWithdrawals[shelterRecipient] = shelterAmount;", to: "pendingWithdrawals[msg.sender] = shelterAmount;", caughtBy: "another-allocator" },
  { name: "withdrawal event missing", from: "emit FundsWithdrawn(msg.sender, amount);", to: "", caughtBy: "recipient-withdraws" },
  { name: "donation event missing", from: "emit DonationReceived(msg.sender, msg.value);", to: "", caughtBy: "positive-donation" },
  { name: "proportions hard-coded to 40/35", from: "uint foodAmount = totalDonated * foodPercent / 100;\n        uint shelterAmount = totalDonated * shelterPercent / 100;", to: "uint foodAmount = totalDonated * 40 / 100;\n        uint shelterAmount = totalDonated * 35 / 100;", caughtBy: "other-proportions" },
];

describe("mutation tests: every broken contract is caught", () => {
  it("each mutant names a real check and changes the source", () => {
    for (const m of MUTANTS) {
      expect(CHECKS.some((c) => c.id === m.caughtBy), m.caughtBy).toBe(true);
      expect(source.includes(m.from), `pattern of "${m.name}" not found`).toBe(true);
    }
  });

  for (const m of MUTANTS) {
    it(`${m.name} is caught by "${m.caughtBy}"`, async () => {
      const bytecode = compile(source.replace(m.from, m.to));
      const check = CHECKS.find((c) => c.id === m.caughtBy)!;
      const result = await runCheck(check, bytecode);
      expect(result.pass, `still passes: ${result.actual}`).toBe(false);
      // Caught for the intended reason, not because the in-browser chain ran out of gas.
      expect(result.actual).not.toMatch(/out of gas/i);
    });
  }
});
