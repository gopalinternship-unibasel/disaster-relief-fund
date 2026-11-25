// The acting account's panel: its one useful next call as the main button, and what the contract
// would say to the other two functions. Every call is simulated first, so a call the contract
// would reject shows the contract's reason and nothing is sent.
import { useEffect, useRef, useState } from "react";
import { parseEther, type Address } from "viem";
import { demoAccountFor } from "../chain/accounts";
import { ETHERSCAN, accountName, duration, shortAddress, ethAmount } from "../app/format";
import type { CampaignView } from "../app/model";
import { explainError, useFundCall, usePrechecks, type TxNotice } from "../app/queries";
import { useSession } from "../app/session";
import { MinedRevertError, SentUnknownError, type CampaignState } from "../contract/fund";
import { campaignRole } from "../app/model";

type Fn = "donate" | "allocateFunds" | "withdraw";
const FN_LABEL: Record<Fn, string> = { donate: "donate()", allocateFunds: "allocateFunds()", withdraw: "withdraw()" };

function parseAmount(text: string): { wei: bigint | null; problem: string | null } {
  const t = text.trim().replace(",", ".");
  if (!t) return { wei: null, problem: "Enter an amount in ETH." };
  if (!/^\d*\.?\d+$/.test(t)) return { wei: null, problem: "Use digits and one decimal point, for example 0.004." };
  const decimals = t.split(".")[1]?.length ?? 0;
  if (decimals > 18) return { wei: null, problem: "ETH has at most 18 decimals." };
  const wei = parseEther(t);
  if (wei === 0n) return { wei, problem: "The contract rejects 0: Donation must be positive." };
  return { wei, problem: null };
}

export function NextStep({ state, view, now }: { state: CampaignState; view: CampaignView; now: bigint }) {
  const s = useSession();
  const [amountText, setAmountText] = useState("0.004");
  const amount = parseAmount(amountText);
  const prechecks = usePrechecks(amount.wei ?? 0n);
  const call = useFundCall();
  const [notice, setNotice] = useState<TxNotice | null>(null);
  const account = s.account;
  // A message about another account's transaction would mislead; clear it on switch.
  useEffect(() => setNotice(null), [account, s.campaign?.address]);
  // The account and campaign a call was sent for, so a late result for another one is not shown.
  const current = useRef({ account, campaign: s.campaign?.address });
  current.current = { account, campaign: s.campaign?.address };

  // When an action removes the focused control (a button that disappears or is disabled), focus
  // would fall back to the page; put it on this panel's heading instead.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false; // never take focus when the page opens
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus({ preventScroll: true });
  }, [account, view.phase, state.allocated, notice]);

  const run = async (fn: Fn, value?: bigint) => {
    setNotice(null);
    const sentFor = { account, campaign: s.campaign?.address };
    const label = fn === "donate" && value !== undefined ? `Donated ${ethAmount(value)}` : fn === "allocateFunds" ? "Funds allocated" : "Withdrawn";
    let next: TxNotice;
    try {
      const result = await call.mutateAsync({ fn, value });
      next = { kind: "done", label, result };
    } catch (e) {
      if (e instanceof MinedRevertError) next = { kind: "reverted", label: FN_LABEL[fn], hash: e.hash, blockNumber: e.blockNumber, fee: e.fee, message: e.reason };
      else if (e instanceof SentUnknownError) next = { kind: "unknown", label: FN_LABEL[fn], hash: e.hash, message: e.detail };
      else next = { kind: "error", label: FN_LABEL[fn], message: explainError(e) };
    }
    if (current.current.account === sentFor.account && current.current.campaign === sentFor.campaign) setNotice(next);
  };

  if (!account) {
    return (
      <aside className="panel" aria-labelledby="next-title">
        <h2 id="next-title" className="panel__title">
          Your next step
        </h2>
        <p>Connect a wallet on Sepolia to donate, allocate or withdraw. Everything on this page can be read without one.</p>
      </aside>
    );
  }

  const demo = demoAccountFor(account);
  const myCategory = view.categories.find((c) => c.recipient.toLowerCase() === account.toLowerCase());
  const myCredit = state.allocated ? (myCategory ? state.pending[myCategory.key] : 0n) : 0n;
  const who = demo ? `Account ${demo.index}` : "your account";
  // The role in this campaign (recipient or organizer), not the simulation account's usual part.
  const role = campaignRole(account, state);

  let primary: Fn | null;
  if (view.phase === "open") primary = "donate";
  else if (view.phase === "awaiting-allocation") primary = "allocateFunds";
  else if (myCredit > 0n) primary = "withdraw";
  else primary = null;

  const reasons = prechecks.data;
  const busy = call.isPending;
  const others = (["donate", "allocateFunds", "withdraw"] as Fn[]).filter((f) => f !== primary);

  return (
    <aside className="panel" aria-labelledby="next-title">
      <h2 id="next-title" className="panel__title" ref={heading} tabIndex={-1}>
        Next step for {who}
      </h2>
      <p className="panel__who">
        {role ? `${capital(role)} in this campaign. ` : "Not a recipient in this campaign. "}
        {s.mode === "sepolia" && <span className="mono">{shortAddress(account)}</span>}
      </p>

      {primary === "donate" && (
        <form
          className="donate"
          onSubmit={(e) => {
            e.preventDefault();
            if (amount.wei && !amount.problem) run("donate", amount.wei);
          }}
        >
          <label className="field__label" htmlFor="donate-amount">
            Donation in ETH
          </label>
          <div className="donate__row">
            <input
              id="donate-amount"
              className="input input--amount num"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-describedby="donate-help"
              aria-invalid={Boolean(amount.problem)}
            />
            <span className="donate__unit">ETH</span>
          </div>
          <p id="donate-help" className={amount.problem ? "field__error" : "field__help"}>
            {amount.problem ?? `Sends ${amount.wei!.toString()} wei with donate(). Open for ${duration(state.endTime - now)} more.`}
          </p>
          <div className="donate__presets" role="group" aria-label="Amounts used in the guide">
            {["0.004", "0.006"].map((v) => (
              <button key={v} type="button" className="btn btn--chip" onClick={() => setAmountText(v)} aria-pressed={amountText === v}>
                {v} ETH
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn--go btn--block" disabled={busy || Boolean(amount.problem)}>
            {busy ? "Sending" : amount.wei && !amount.problem ? `Donate ${ethAmount(amount.wei)}` : "Donate"}
          </button>
        </form>
      )}

      {primary === "allocateFunds" && (
        <div className="primary">
          <p>
            The deadline has passed. Anyone can now record the three credits; allocateFunds() pays nobody, and the caller gets no
            reward.
          </p>
          <button type="button" className="btn btn--go btn--block" disabled={busy || Boolean(reasons?.allocateFunds)} onClick={() => run("allocateFunds")}>
            {busy ? "Sending" : "Allocate the funds"}
          </button>
          {reasons?.allocateFunds && (
            <p className="field__help">Not yet: the chain's newest block is still before the deadline ({reasons.allocateFunds}). Blocks come every 12 seconds.</p>
          )}
        </div>
      )}

      {primary === "withdraw" && (
        <div className="primary">
          <p>
            The contract holds a credit of <strong className="num">{ethAmount(myCredit)}</strong> for this account.
          </p>
          <button type="button" className="btn btn--go btn--block" disabled={busy} onClick={() => run("withdraw")}>
            {busy ? "Sending" : `Withdraw ${ethAmount(myCredit)}`}
          </button>
          <p className="field__help">
            Calls withdraw(). The contract sets the credit to zero, then sends {ethAmount(myCredit)} to {shortAddress(account)}. This account
            pays the gas.
          </p>
        </div>
      )}

      {primary === null && <NoAction state={state} view={view} account={account} />}

      {notice && <TxMessage notice={notice} />}

      <div className="others">
        <h3 className="others__title">Other calls from {who}</h3>
        <ul>
          {others.map((fn) => {
            const reason = reasons?.[fn];
            return (
              <li key={fn} className="others__item">
                <div>
                  <code className="others__fn">{FN_LABEL[fn]}</code>
                  <p className="others__state">
                    {prechecks.isLoading ? "Checking" : reason ? `Would be rejected: ${reason}` : "Would be accepted"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={`Call ${FN_LABEL[fn]}`}
                  disabled={busy}
                  onClick={() => run(fn, fn === "donate" ? (amount.wei && amount.wei > 0n ? amount.wei : parseEther("0.001")) : undefined)}
                  title={reason ? "The contract's answer is shown and nothing is sent" : undefined}
                >
                  Call
                </button>
              </li>
            );
          })}
        </ul>
        <p className="others__note">
          Every call is checked against the contract first; a call rejected by that check sends nothing and costs nothing.
          {s.mode === "sepolia" && " A call that passes can still revert if another transaction changes the contract first; it then costs gas."}
        </p>
      </div>
    </aside>
  );
}

function NoAction({ state, view, account }: { state: CampaignState; view: CampaignView; account: Address }) {
  const s = useSession();
  const waiting = view.categories.filter((c) => c.owed > 0n);
  if (view.phase === "finished") {
    return (
      <p className="primary">
        {state.totalDonated === 0n
          ? "Nothing was donated, so allocation recorded three zero credits. The campaign is finished."
          : "All credits have been withdrawn. The campaign is finished; a new campaign needs a new deployment."}
      </p>
    );
  }
  return (
    <div className="primary">
      <p>
        {view.categories.some((c) => c.recipient.toLowerCase() === account.toLowerCase() && c.withdrawn > 0n)
          ? `${accountName(account)} already withdrew its credit.`
          : `${accountName(account)} has no credit to withdraw.`} {waiting.length === 1 ? "One recipient is" : `${waiting.length} recipients are`} still
        waiting: {waiting.map((c) => `${c.label.toLowerCase()} (${ethAmount(c.owed)})`).join(", ")}.
      </p>
      {s.sim && (
        <div className="switchers">
          {waiting.map((c) => {
            const demo = demoAccountFor(c.recipient);
            return demo ? (
              <button key={c.key} type="button" className="btn btn--secondary" onClick={() => s.sim!.setAccount(demo.index)}>
                Act as Account {demo.index}, {c.label.toLowerCase()}
              </button>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

function TxMessage({ notice }: { notice: TxNotice }) {
  const s = useSession();
  const txLink = (hash: string) =>
    s.mode === "sepolia" ? (
      <a href={`${ETHERSCAN}/tx/${hash}`} target="_blank" rel="noreferrer">
        View on Etherscan
      </a>
    ) : (
      <span className="mono" title={hash}>
        {shortAddress(hash)}
      </span>
    );
  if (notice.kind === "reverted") {
    return (
      <div className="txmsg txmsg--error" role="alert">
        <p className="txmsg__title">{notice.label}: mined, then reverted</p>
        <p>{notice.message}</p>
        <p className="txmsg__meta">
          Block {notice.blockNumber.toString()}. The gas fee of {ethAmount(notice.fee, 12)} was paid; nothing else changed. {txLink(notice.hash)}
        </p>
      </div>
    );
  }
  if (notice.kind === "unknown") {
    return (
      <div className="txmsg txmsg--error" role="alert">
        <p className="txmsg__title">{notice.label}: sent, result not confirmed</p>
        <p>{notice.message}</p>
        <p className="txmsg__meta">Check the transaction before sending it again. {txLink(notice.hash)}</p>
      </div>
    );
  }
  if (notice.kind === "error") {
    return (
      <div className="txmsg txmsg--error" role="alert">
        <p className="txmsg__title">{notice.label}: rejected</p>
        <p>{notice.message}</p>
        <p className="txmsg__meta">Nothing was sent.</p>
      </div>
    );
  }
  const r = notice.result;
  return (
    <div className="txmsg txmsg--done" role="status">
      <p className="txmsg__title">{notice.label}</p>
      <p className="txmsg__meta">
        Block {r.blockNumber.toString()}, gas fee {ethAmount(r.fee, 12)}.{" "}
        {s.mode === "sepolia" ? (
          <a href={`${ETHERSCAN}/tx/${r.hash}`} target="_blank" rel="noreferrer">
            View on Etherscan
          </a>
        ) : (
          <span className="mono" title={r.hash}>
            {shortAddress(r.hash)}
          </span>
        )}
      </p>
    </div>
  );
}

function capital(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

