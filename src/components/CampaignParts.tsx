import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { tableFeatures, createColumnHelper, useTable } from "@tanstack/react-table";
import { formatEther } from "viem";
import { demoAccountFor } from "../chain/accounts";
import { ETHERSCAN, accountName, clockTime, decimalsFor, duration, eth, ethFixed, plural, shortAddress, copyText, ethAmount } from "../app/format";
import { balancesAfter, type CampaignView } from "../app/model";
import { useSession } from "../app/session";
import type { CampaignState, FundEvent } from "../contract/fund";

// ---------------------------------------------------------------- header

export function CampaignHeader({ state, view, now, deployBlock }: { state: CampaignState; view: CampaignView; now: bigint; deployBlock: bigint }) {
  const s = useSession();
  return (
    <header className="campaign-head">
      <h1 className="campaign-head__title">{state.campaignName || "Unnamed campaign"}</h1>
      <p className="campaign-head__summary">{summary(state, view, now)}</p>
      <dl className="facts">
        <div>
          <dt>Contract</dt>
          <dd>
            <Copyable text={state.address} />
            {s.mode === "sepolia" && (
              <a className="facts__link" href={`${ETHERSCAN}/address/${state.address}`} target="_blank" rel="noreferrer">
                Etherscan
              </a>
            )}
            <Link to="/open" className="facts__link">
              Open another campaign
            </Link>
          </dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>
            {demoAccountFor(state.creator) ? `${accountName(state.creator)} ` : ""}
            <span className="mono">{state.creator}</span>
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{s.mode === "simulation" ? "Simulation in this page, chain ID 31337" : "Sepolia, chain ID 11155111"}, deployed in block {deployBlock.toString()}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>
            <span className="num">{clockTime(state.endTime)}</span> (endTime {state.endTime.toString()}),{" "}
            {now < state.endTime ? `in ${duration(state.endTime - now)}` : `passed ${duration(now - state.endTime)} ago`}
          </dd>
        </div>
        <div>
          <dt>Split</dt>
          <dd>
            Food and water {state.percents.food.toString()}%, shelter {state.percents.shelter.toString()}%, medical supplies{" "}
            {state.percents.medical.toString()}%
          </dd>
        </div>
      </dl>
    </header>
  );
}

function summary(state: CampaignState, view: CampaignView, now: bigint): string {
  const total = `${ethAmount(state.totalDonated)}`;
  const n = view.donationCount === null ? "donations" : view.donationCount === 1 ? "1 donation" : `${view.donationCount} donations`;
  const from = view.donationCount === null ? "" : ` from ${n}`;
  switch (view.phase) {
    case "open":
      return state.totalDonated === 0n
        ? `Donations are open for another ${duration(state.endTime - now)}. Nothing has been donated yet.`
        : `Donations are open for another ${duration(state.endTime - now)}. So far ${total} has been donated${view.donationCount === null ? "" : `, in ${n}`}.`;
    case "awaiting-allocation":
      return `Donations closed ${duration(now - state.endTime)} ago with ${total}${from}. Nothing is credited until someone calls allocateFunds().`;
    case "withdrawals": {
      const waiting = view.categories.filter((c) => c.owed > 0n).length;
      return view.paidOut === 0n
        ? `All ${total} is allocated and still in the contract, waiting for the ${waiting === 1 ? "one recipient" : `${waiting} recipients`} to withdraw.`
        : `All ${total} is allocated. Withdrawn so far: ${ethAmount(view.paidOut)}; still in the contract: ${ethAmount(state.balance)}, waiting for ${waiting === 1 ? "one recipient" : `${waiting} recipients`}.`;
    }
    case "finished":
      return state.totalDonated === 0n
        ? "The deadline passed with no donations. Allocation recorded three zero credits, so there is nothing to withdraw."
        : `Every credit has been withdrawn and the contract holds ${ethAmount(state.balance)}. totalDonated still reads ${total}: it records donations, not the balance.`;
  }
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copyable">
      <span className="mono copyable__text">{text}</span>
      <button
        type="button"
        className="btn btn--tiny"
        onClick={async () => {
          if (await copyText(text)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- lifecycle (a real sequence)

export function Lifecycle({ state, view, now, deployBlock }: { state: CampaignState; view: CampaignView; now: bigint; deployBlock: bigint }) {
  const steps = [
    { title: "Deployed", detail: `Block ${deployBlock}, by ${accountName(state.creator)}`, done: true, current: false },
    {
      title: view.deadlinePassed ? "Donations closed at the deadline" : "Donations open until the deadline",
      detail:
        now < state.endTime
          ? `Closes in ${duration(state.endTime - now)}${view.donationCount === null ? "" : view.donationCount === 0 ? "; no donations yet" : `; ${plural(view.donationCount, "donation")} so far`}`
          : `Closed ${duration(now - state.endTime)} ago${view.donationCount === null ? "" : `; ${plural(view.donationCount, "donation")}`}`,
      done: view.deadlinePassed,
      current: !view.deadlinePassed,
    },
    {
      title: "Allocation",
      detail: state.allocated
        ? `Block ${view.allocationBlock ?? "?"}${view.allocationCaller ? `, called by ${accountName(view.allocationCaller)}` : ""}`
        : view.deadlinePassed
          ? "Waiting for anyone to call allocateFunds()"
          : "Possible at the deadline",
      done: state.allocated,
      current: view.deadlinePassed && !state.allocated,
    },
    {
      title: "Withdrawals",
      detail: state.allocated ? (view.withdrawalsExpected === 0 ? "No credits to withdraw" : `${view.withdrawalsDone} of ${view.withdrawalsExpected} done`) : "After allocation",
      done: state.allocated && view.withdrawalsDone >= view.withdrawalsExpected,
      current: state.allocated && view.withdrawalsDone < view.withdrawalsExpected,
    },
  ];
  return (
    <ol className="lifecycle" aria-label="Campaign stages">
      {steps.map((step, i) => (
        <li key={step.title} className={`lifecycle__step${step.done ? " is-done" : ""}${step.current ? " is-current" : ""}`} aria-current={step.current ? "step" : undefined}>
          <span className="lifecycle__marker" aria-hidden="true">
            {step.done ? (
              <svg viewBox="0 0 16 16">
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span className="lifecycle__title">{step.title}</span>
          <span className="lifecycle__detail">{step.detail}</span>
          <span className="visually-hidden">{step.done ? " (done)" : step.current ? " (current)" : " (not yet)"}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- amounts in tables

/** True when some figure would be cut at `dp` decimals, so the table offers exact wei. */
function cutAt(values: bigint[], dp: number) {
  return values.some((v) => (formatEther(v < 0n ? -v : v).split(".")[1] ?? "").length > dp);
}
const figure = (v: bigint, dp: number, inWei: boolean) => (inWei ? v.toString() : ethFixed(v, dp));

function UnitToggle({ inWei, setInWei }: { inWei: boolean; setInWei: (v: boolean) => void }) {
  return (
    <button type="button" className="linkbtn" aria-pressed={inWei} onClick={() => setInWei(!inWei)}>
      {inWei ? "Show amounts in ETH" : "Show exact amounts in wei"}
    </button>
  );
}

// ---------------------------------------------------------------- recipients

export function RecipientsTable({ state, view }: { state: CampaignState; view: CampaignView }) {
  const s = useSession();
  const values = view.categories.flatMap((c) => [c.credit, c.withdrawn, c.owed]);
  const dp = decimalsFor(values);
  const cut = cutAt(values, dp);
  const [inWei, setInWei] = useState(false);
  const totals = view.categories.reduce(
    (t, c) => ({ credit: t.credit + c.credit, withdrawn: t.withdrawn + c.withdrawn, owed: t.owed + c.owed }),
    { credit: 0n, withdrawn: 0n, owed: 0n },
  );
  return (
    <section className="block" aria-labelledby="recipients-title">
      <div className="block__head">
        <h2 id="recipients-title">Recipients</h2>
        <p className="block__note">
          Fixed at deployment. Each recipient withdraws its own credit. Amounts in {inWei ? "wei" : "ETH"}
          {cut && !inWei ? `, cut to ${dp} decimals` : ""}. {(cut || inWei) && <UnitToggle inWei={inWei} setInWei={setInWei} />}
        </p>
      </div>
      <div className="tablewrap">
        <table className="table table--stack">
          <thead>
            <tr>
              <th scope="col">Purpose</th>
              <th scope="col" className="num-col">
                Share
              </th>
              <th scope="col">Recipient</th>
              <th scope="col" className="num-col">
                {state.allocated ? "Credit" : "Would get"}
              </th>
              <th scope="col" className="num-col">
                Withdrawn
              </th>
              <th scope="col" className="num-col">
                Still owed
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.categories.map((c) => {
              const demo = demoAccountFor(c.recipient);
              const acting = s.account;
              const isYou = acting !== null && c.recipient.toLowerCase() === acting.toLowerCase();
              const status = !state.allocated
                ? "Not allocated yet"
                : c.withdrawn > 0n
                  ? c.withdrawBlock !== null
                    ? `Withdrawn in block ${c.withdrawBlock}`
                    : "Withdrawn"
                  : c.credit === 0n
                    ? "Credit 0, nothing to withdraw"
                    : "Not withdrawn yet";
              return (
                <tr key={c.key} className={isYou ? "is-you" : undefined}>
                  <th scope="row">
                    <span className={`cat cat--${c.key}`}>{c.label}</span>
                  </th>
                  <td className="num-col num" data-label="Share">{c.percent.toString()}%</td>
                  <td data-label="Recipient">
                    <span className="recipient">
                      <span>
                        {demo ? `Account ${demo.index}` : ""}
                        {isYou && <span className="you-tag">{s.mode === "sepolia" ? "you" : "acting"}</span>}
                      </span>
                      <span className="mono recipient__addr" title={c.recipient}>
                        {demo ? shortAddress(c.recipient) : c.recipient}
                      </span>
                    </span>
                    {s.sim && demo && !isYou && (
                      <button
                        type="button"
                        className="linkbtn linkbtn--row"
                        aria-label={`Act as Account ${demo.index}, the ${c.label.toLowerCase()} recipient`}
                        onClick={() => s.sim!.setAccount(demo.index)}
                      >
                        Act as this account
                      </button>
                    )}
                  </td>
                  <td className={`num-col num${c.projected ? " is-projected" : ""}`} title={`${c.credit} wei`} data-label={state.allocated ? "Credit" : "Would get"}>
                    {figure(c.credit, dp, inWei)}
                  </td>
                  <td className="num-col num" title={`${c.withdrawn} wei`} data-label="Withdrawn">
                    {figure(c.withdrawn, dp, inWei)}
                  </td>
                  <td className="num-col num" title={`${c.owed} wei`} data-label="Still owed">
                    {figure(c.owed, dp, inWei)}
                  </td>
                  <td data-label="Status">{status}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num-col num" data-label="Share">100%</td>
              <td className="cell-empty" />
              <td className="num-col num" data-label={state.allocated ? "Credit" : "Would get"}>{figure(totals.credit, dp, inWei)}</td>
              <td className="num-col num" data-label="Withdrawn">{figure(totals.withdrawn, dp, inWei)}</td>
              <td className="num-col num" data-label="Still owed">{figure(totals.owed, dp, inWei)}</td>
              <td className="cell-empty" />
            </tr>
          </tfoot>
        </table>
      </div>
      {!state.allocated && state.totalDonated > 0n && (
        <p className="block__foot">
          “Would get” applies the shares to today's total, exactly as allocateFunds() will: food and shelter round down, medical receives
          the rest, so every wei is assigned.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- activity (TanStack Table)

type Row = { event: FundEvent; balanceAfter: bigint };
const features = tableFeatures({});
const col = createColumnHelper<typeof features, Row>();

export function ActivityTable({ events, loading, error }: { events: FundEvent[]; loading: boolean; error: string | null }) {
  const s = useSession();
  const after = balancesAfter(events);
  const data: Row[] = [...events].reverse().map((event) => ({ event, balanceAfter: after.get(event) ?? 0n }));
  const values = events.flatMap((e) => (e.kind === "allocation" ? [] : [e.amount])).concat([...after.values()]);
  const dp = decimalsFor(values);
  const cut = cutAt(values, dp);
  const [inWei, setInWei] = useState(false);
  const columns = col.columns([
    col.accessor((r) => r.event.blockNumber, {
      id: "block",
      header: "Block",
      cell: (info) => {
        const e = info.row.original.event;
        return (
          <span className="activity__block">
            <span className="num">{e.blockNumber.toString()}</span>
            {e.timestamp !== undefined && <span className="activity__time num">{clockTime(e.timestamp)}</span>}
          </span>
        );
      },
    }),
    col.accessor((r) => r.event.kind, {
      id: "event",
      header: "Event",
      cell: (info) => <span className="activity__event">{eventName(info.row.original.event)}</span>,
    }),
    col.display({
      id: "what",
      header: "What happened",
      cell: (info) => <What event={info.row.original.event} />,
    }),
    col.display({
      id: "change",
      header: "Change",
      cell: (info) => {
        const e = info.row.original.event;
        const delta = e.kind === "donation" ? e.amount : e.kind === "withdrawal" ? -e.amount : 0n;
        return (
          <span className="num" title={`${delta} wei`}>
            {delta === 0n ? figure(0n, dp, inWei) : `${delta > 0n ? "+" : ""}${figure(delta, dp, inWei)}`}
          </span>
        );
      },
    }),
    col.accessor("balanceAfter", {
      header: "Balance after",
      cell: (info) => (
        <span className="num" title={`${info.getValue()} wei`}>
          {figure(info.getValue(), dp, inWei)}
        </span>
      ),
    }),
    col.display({
      id: "tx",
      header: "Transaction",
      cell: (info) => {
        const hash = info.row.original.event.txHash;
        return s.mode === "sepolia" ? (
          <a className="mono nowrap" href={`${ETHERSCAN}/tx/${hash}`} target="_blank" rel="noreferrer">
            {shortAddress(hash)}
          </a>
        ) : (
          <span className="mono nowrap" title={hash}>
            {shortAddress(hash)}
          </span>
        );
      },
    }),
  ]);
  const table = useTable({ features, columns, data });
  const numeric = new Set(["change", "balanceAfter"]);

  return (
    <section className="block" aria-labelledby="activity-title">
      <div className="block__head">
        <h2 id="activity-title">Activity</h2>
        <p className="block__note">
          The contract's events, newest first. Amounts in {inWei ? "wei" : "ETH"}
          {cut && !inWei ? `, cut to ${dp} decimals` : ""}; balance computed from the events. {(cut || inWei) && <UnitToggle inWei={inWei} setInWei={setInWei} />}
        </p>
      </div>
      {error && (
        <p className="notice notice--warn" role="status">
          Could not read the contract's event history: {error}. The totals above come straight from the contract; the history is read
          again automatically.
        </p>
      )}
      {events.length === 0 && error ? null : events.length === 0 ? (
        <p className="empty">{loading ? "Reading the contract's events" : "No events yet. Each donation, the allocation and each withdrawal appears here."}</p>
      ) : (
        <div className="tablewrap">
          <table className="table table--activity table--stack">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} scope="col" className={numeric.has(header.column.id) ? "num-col" : undefined}>
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className={numeric.has(cell.column.id) ? "num-col" : undefined} data-label={LABELS[cell.column.id]}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const LABELS: Record<string, string> = { block: "Block", event: "Event", what: "What happened", change: "Change", balanceAfter: "Balance after", tx: "Transaction" };

function eventName(e: FundEvent) {
  return e.kind === "donation" ? "DonationReceived" : e.kind === "allocation" ? "FundsAllocated" : "FundsWithdrawn";
}

function What({ event: e }: { event: FundEvent }) {
  if (e.kind === "donation") return <>{accountName(e.donor)} donated {ethAmount(e.amount)}.</>;
  if (e.kind === "allocation")
    return (
      <>
        {e.caller ? `${accountName(e.caller)} allocated the funds. ` : "Funds allocated. "}Credits: food and water {eth(e.food)}, shelter {eth(e.shelter)}, medical
        supplies {ethAmount(e.medical)}. No ETH moved.
      </>
    );
  return <>{accountName(e.recipient)} withdrew {ethAmount(e.amount)}.</>;
}
