// "Where the money is now": a ledger and a diagram drawn to scale. Donations flow into the
// contract, split into the three recorded credits, and either leave the contract (withdrawn) or
// stop at its wall (still held). Before allocation the credits are drawn as outlines: what
// allocateFunds() would record if it ran now.
import { useEffect, useRef, useState } from "react";
import type { CampaignState } from "../contract/fund";
import { accountName, eth, shortAddress, weiText, ethAmount } from "../app/format";
import type { CampaignView, DonorView } from "../app/model";

type Props = { state: CampaignState; view: CampaignView; you: string | null };
/** Below this width the diagram's text would be too small, so the stage shows bars instead. */
const MIN_DIAGRAM_WIDTH = 860;

export function MoneyStage({ state, view, you }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1040);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = width >= MIN_DIAGRAM_WIDTH;

  const credited = state.allocated ? state.totalDonated : 0n;
  const matches = view.heldByEvents === state.balance;

  return (
    <section className="stage" aria-labelledby="stage-title">
      <div className="stage__head">
        <h2 id="stage-title">Where the money is now</h2>
        <p className="stage__asof">As of block {state.blockNumber.toString()}</p>
      </div>
      <div className="stage__body">
        <dl className="ledger">
          <div className="ledger__row">
            <dt>Donated</dt>
            <dd>
              <Amount wei={state.totalDonated} />
              <span className="ledger__note">
                {view.donationCount === null ? "number of donations: history not read yet" : view.donationCount === 1 ? "1 donation" : `${view.donationCount} donations`}
              </span>
            </dd>
          </div>
          <div className="ledger__row">
            <dt>Credited</dt>
            <dd>
              <Amount wei={credited} />
              <span className="ledger__note">{state.allocated ? `by allocateFunds() in block ${view.allocationBlock ?? "?"}` : "nothing until allocateFunds() runs"}</span>
            </dd>
          </div>
          <div className="ledger__row">
            <dt>Paid out</dt>
            <dd>
              <Amount wei={view.paidOut} />
              <span className="ledger__note">{view.withdrawalsDone === 1 ? "1 withdrawal" : `${view.withdrawalsDone} withdrawals`}</span>
            </dd>
          </div>
          <div className="ledger__row ledger__row--total">
            <dt>Held by the contract</dt>
            <dd>
              <Amount wei={state.balance} />
              <span className="ledger__note">
                {!view.historyLoaded
                  ? "the contract's balance on chain"
                  : matches
                    ? "the contract's balance on chain; it equals donations minus withdrawals"
                    : `the balance on chain differs from donations minus withdrawals (${ethAmount(view.heldByEvents)})`}
              </span>
            </dd>
          </div>
          <p className="ledger__wei">
            totalDonated reads <span className="nowrap">{weiText(state.totalDonated)}</span>
          </p>
        </dl>
        <div className="stage__diagram" ref={ref}>
          {state.totalDonated === 0n ? (
            <EmptyFlow state={state} />
          ) : wide ? (
            <FlowDiagram state={state} view={view} you={you} width={width} />
          ) : (
            <FlowBars state={state} view={view} you={you} />
          )}
        </div>
      </div>
      <ul className="stage__legend">
        <li>
          <i className="swatch swatch--donated" aria-hidden="true" /> Donations
        </li>
        <li>
          <i className="swatch swatch--held" aria-hidden="true" /> Credit held in the contract
        </li>
        <li>
          <i className="swatch swatch--paid" aria-hidden="true" /> Paid out
        </li>
        {!state.allocated && (
          <li>
            <i className="swatch swatch--projected" aria-hidden="true" /> Would be credited if allocated now
          </li>
        )}
        <li className="stage__legend-scale">{state.totalDonated === 0n ? "" : wide ? "Band thickness to scale" : "Bar length to scale"}</li>
      </ul>
    </section>
  );
}

function Amount({ wei }: { wei: bigint }) {
  const text = eth(wei, 6);
  const tiny = text.endsWith(" wei");
  const approx = text.startsWith("≈");
  const value = tiny ? text.replace(" wei", "") : approx ? text.slice(1) : text;
  return (
    <span className="amount" title={weiText(wei)}>
      {approx && (
        <span className="amount__approx" aria-label="about">
          ≈
        </span>
      )}
      <span className="amount__value num">{value}</span>
      <span className="amount__unit">{tiny ? "wei" : "ETH"}</span>
    </span>
  );
}

const MAX_DONORS = 4;
function groupDonors(donors: DonorView[], total: bigint): { label: string; sub: string; amount: bigint }[] {
  // The event history can arrive after the totals; until it does, show the total as one band.
  const known = donors.reduce((sum, d) => sum + d.amount, 0n);
  if (donors.length === 0) return [{ label: "Donations", sub: "donor history not read yet", amount: total }];
  if (known !== total) return [{ label: "Donations", sub: "some donations are before the first block read", amount: total }];
  const sorted = [...donors].sort((a, b) => (a.firstBlock < b.firstBlock ? -1 : a.firstBlock > b.firstBlock ? 1 : 0));
  if (sorted.length <= MAX_DONORS) return sorted.map((d) => donorLabel(d, d.amount));
  const head = sorted.slice(0, MAX_DONORS - 1).map((d) => donorLabel(d, d.amount));
  const rest = sorted.slice(MAX_DONORS - 1);
  const amount = rest.reduce((s, d) => s + d.amount, 0n);
  return [...head, { label: `${rest.length} other donors`, sub: "", amount }];
}
function donorLabel(d: DonorView, amount: bigint) {
  return { label: accountName(d.donor), sub: d.count > 1 ? `${d.count} donations` : `block ${d.firstBlock}`, amount };
}

/** A ribbon from one vertical span to another. */
function ribbon(x0: number, y0t: number, y0b: number, x1: number, y1t: number, y1b: number, xStart = x0) {
  const xm = (x0 + x1) / 2;
  return `M${xStart},${y0t} L${x0},${y0t} C${xm},${y0t} ${xm},${y1t} ${x1},${y1t} L${x1},${y1b} C${xm},${y1b} ${xm},${y0b} ${x0},${y0b} L${xStart},${y0b} Z`;
}

const MIN_BAND = 3;

function FlowDiagram({ state, view, you, width }: Props & { width: number }) {
  // The viewBox is as wide as the space it gets, so text keeps its CSS size; only the middle
  // (bands and ribbons) stretches or narrows. Labels keep fixed room on both sides.
  const W = Math.max(MIN_DIAGRAM_WIDTH, Math.round(width));
  const m = (W - 170 - 250) / 620;
  const X = (x: number) => 170 + (x - 170) * m;
  const TOTAL_H = 250; // pixels for the whole amount
  const GAP = 16;
  const k = TOTAL_H / Number(state.totalDonated);
  const px = (wei: bigint) => (wei === 0n ? 0 : Math.max(MIN_BAND, Number(wei) * k));

  const donors = groupDonors(view.donors, state.totalDonated);
  const donorH = donors.map((d) => px(d.amount));
  const donorBlock = donorH.reduce((a, b) => a + b, 0) + GAP * (donors.length - 1);
  const cats = view.categories;
  const catH = cats.map((c) => px(c.credit));
  const catBlock = catH.reduce((a, b) => a + b, 0) + GAP * 2;
  const trunkH = px(state.totalDonated);
  const H = Math.max(donorBlock, catBlock, trunkH) + 104;
  const mid = H / 2 + 18;

  // Columns
  const xDonor0 = X(170), xDonor1 = X(230);
  const xTrunk0 = X(330), xTrunk1 = X(372);
  const xCat0 = X(470), xCat1 = X(640);
  const xWall = X(700), xOut = X(790);
  const xBox = X(300);
  const boxTop = 18;

  let y = mid - donorBlock / 2;
  const donorRects = donors.map((d, i) => {
    const r = { ...d, y, h: donorH[i] };
    y += donorH[i] + GAP;
    return r;
  });
  let ty = mid - trunkH / 2;
  const donorIntoTrunk = donorRects.map((r) => {
    const t = { y0: ty, y1: ty + r.h };
    ty += r.h;
    return t;
  });
  let cy = mid - catBlock / 2;
  const catRects = cats.map((c, i) => {
    const r = { c, y: cy, h: catH[i] };
    cy += catH[i] + GAP;
    return r;
  });
  let sy = mid - trunkH / 2;
  const trunkToCat = catRects.map((r) => {
    const t = { y0: sy, y1: sy + r.h };
    sy += r.h;
    return t;
  });

  // Label positions: centred on their band, pushed apart when bands are thin.
  const spread = (centres: number[], minGap: number) => {
    const out = [...centres];
    for (let i = 1; i < out.length; i++) if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
    return out;
  };
  const donorLabelY = spread(donorRects.map((r) => r.y + r.h / 2), 44);
  const catLabelY = spread(catRects.map((r) => r.y + r.h / 2), 62);
  const labelBottom = Math.max(donorLabelY[donorLabelY.length - 1] + 30, catLabelY[catLabelY.length - 1] + 44);
  const height = Math.max(H, labelBottom + 10);

  const unit = niceScale(state.totalDonated);
  const unitPx = Number(unit) * k;

  return (
    <svg className="flow" viewBox={`0 0 ${W} ${height}`} role="img" aria-labelledby="flow-title flow-desc">
      <title id="flow-title">Diagram of where the donated ETH is</title>
      <desc id="flow-desc">{describe(state, view)}</desc>

      {/* the contract */}
      <rect className="flow__box" x={xBox} y={boxTop} width={xWall - xBox} height={height - 10 - boxTop} rx={4} />
      <text className="flow__boxlabel" x={xBox + 16} y={boxTop + 22}>
        Contract <tspan className="flow__mono">{shortAddress(state.address)}</tspan>
      </text>
      <text className="flow__sub" x={xBox + 16} y={boxTop + 42}>
        holds {ethAmount(state.balance)}
      </text>

      {/* donors into the contract */}
      {donorRects.map((r, i) => (
        <g key={`d${i}`}>
          <path className="band band--donated" d={ribbon(xDonor1, r.y, r.y + r.h, xTrunk0 + 1, donorIntoTrunk[i].y0, donorIntoTrunk[i].y1, xDonor0)} />
          <text className="flow__label" x={xDonor0 - 12} y={donorLabelY[i] - 3} textAnchor="end">
            {r.label}
          </text>
          <text className="flow__sub" x={xDonor0 - 12} y={donorLabelY[i] + 16} textAnchor="end">
            {ethAmount(r.amount)}{r.sub ? `, ${r.sub}` : ""}
          </text>
        </g>
      ))}
      <rect className="band band--donated" x={xTrunk0} y={mid - trunkH / 2} width={xTrunk1 - xTrunk0} height={trunkH} />

      {/* the split into three credits */}
      {catRects.map((r, i) => {
        const projected = r.c.projected;
        const paid = !projected && r.c.withdrawn > 0n;
        const status = projected
          ? `would be ${ethAmount(r.c.credit)}`
          : paid
            ? `paid ${ethAmount(r.c.withdrawn)}`
            : r.c.credit === 0n
              ? "credit 0, nothing to withdraw"
              : `${ethAmount(r.c.owed)} to withdraw`;
        return (
          <g key={r.c.key}>
            {r.h > 0 && (
              <>
                {projected ? (
                  <>
                    <path className="band band--projected-flow" d={ribbon(xTrunk1 - 1, trunkToCat[i].y0, trunkToCat[i].y1, xCat0, r.y, r.y + r.h)} />
                    <rect className="band band--projected" x={xCat0} y={r.y} width={xCat1 - xCat0} height={r.h} />
                  </>
                ) : paid ? (
                  <>
                    <path className="band band--held" d={ribbon(xTrunk1 - 1, trunkToCat[i].y0, trunkToCat[i].y1, xCat0 + 1, r.y, r.y + r.h)} />
                    <path className="band band--paid" d={`M${xCat0},${r.y} L${xOut - 18},${r.y} L${xOut},${r.y + r.h / 2} L${xOut - 18},${r.y + r.h} L${xCat0},${r.y + r.h} Z`} />
                  </>
                ) : (
                  <>
                    <path className="band band--held" d={`${ribbon(xTrunk1 - 1, trunkToCat[i].y0, trunkToCat[i].y1, xCat0 + 1, r.y, r.y + r.h)} M${xCat0},${r.y} H${xCat1} V${r.y + r.h} H${xCat0} Z`} />
                    <rect className="flow__barrier" x={xCat1} y={r.y - 3} width={4} height={r.h + 6} />
                  </>
                )}
                {r.h >= 18 && (
                  <text className={projected ? "flow__inband flow__inband--light" : "flow__inband"} x={xCat0 + 12} y={r.y + r.h / 2 + 5}>
                    {eth(r.c.credit)}
                  </text>
                )}
              </>
            )}
            {!paid && !projected && r.h > 0 && <path className="flow__leader" d={`M${xCat1 + 10},${r.y + r.h / 2} H${xOut + 4} L${xOut + 18},${catLabelY[i]}`} fill="none" />}
            <text className="flow__label" x={xOut + 26} y={catLabelY[i] - 8}>
              {r.c.label}
            </text>
            <text className="flow__sub" x={xOut + 26} y={catLabelY[i] + 12}>
              {accountName(r.c.recipient, you)}, {r.c.percent.toString()}%
            </text>
            <text className="flow__sub" x={xOut + 26} y={catLabelY[i] + 31}>
              {status}
            </text>
          </g>
        );
      })}

      {/* scale bar */}
      {unitPx >= 4 && unitPx <= 120 && (
        <g className="flow__scale">
          <rect x={16} y={height - 16 - unitPx} width={4} height={unitPx} />
          <text x={28} y={height - 18}>
            Scale: {ethAmount(unit)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Phones: the same facts as three stacked bars of equal width. */
function FlowBars({ state, view, you }: Props) {
  const total = Number(state.totalDonated);
  const pct = (wei: bigint) => `${((Number(wei) / total) * 100).toFixed(3)}%`;
  const donors = groupDonors(view.donors, state.totalDonated);
  return (
    <div className="bars">
      <div className="bars__row">
        <p className="bars__name">Donated</p>
        <div className="bars__track">
          {donors.map((d, i) => (
            <span key={i} className="bars__seg seg--donated" style={{ width: pct(d.amount) }} />
          ))}
        </div>
        <ul className="bars__keys">
          {donors.map((d, i) => (
            <li key={i}>
              {d.label}: {ethAmount(d.amount)}
            </li>
          ))}
        </ul>
      </div>
      <div className="bars__row">
        <p className="bars__name">{state.allocated ? "Credited" : "Would be credited"}</p>
        <div className="bars__track">
          {view.categories.map((c) => (
            <span key={c.key} className={`bars__seg ${c.projected ? "seg--projected" : "seg--held"}`} style={{ width: pct(c.credit) }} />
          ))}
        </div>
        <ul className="bars__keys">
          {view.categories.map((c) => (
            <li key={c.key}>
              {c.label}, {accountName(c.recipient, you)}: {ethAmount(c.credit)}
            </li>
          ))}
        </ul>
      </div>
      <div className="bars__row">
        <p className="bars__name">Now</p>
        <div className="bars__track">
          {view.categories.map((c) => (
            <span
              key={c.key}
              className={`bars__seg ${c.projected ? "seg--donated" : c.withdrawn > 0n ? "seg--paid" : "seg--held"}`}
              style={{ width: pct(c.credit) }}
            />
          ))}
        </div>
        <ul className="bars__keys">
          <li>Paid out: {ethAmount(view.paidOut)}</li>
          <li>Still in the contract: {ethAmount(state.balance)}</li>
        </ul>
      </div>
    </div>
  );
}

function EmptyFlow({ state }: { state: CampaignState }) {
  return (
    <div className="flow-empty">
      <p className="flow-empty__title">No donations yet</p>
      <p>
        The contract holds {ethAmount(state.balance)}. Each donate() call made before the deadline adds to totalDonated; the diagram
        fills in from the first one.
      </p>
    </div>
  );
}

/** A round amount for the scale bar: 1, 2 or 5 times a power of ten, about a tenth of the total. */
function niceScale(total: bigint): bigint {
  const target = total / 10n;
  if (target <= 0n) return 1n;
  let p = 1n;
  while (p * 10n <= target) p *= 10n;
  if (p * 5n <= target) return p * 5n;
  if (p * 2n <= target) return p * 2n;
  return p;
}

function describe(state: CampaignState, view: CampaignView) {
  const count = view.donationCount === null ? "" : view.donationCount === 1 ? " in 1 donation" : ` in ${view.donationCount} donations`;
  const parts = [`${ethAmount(state.totalDonated)} donated${count}.`];
  if (!state.allocated) parts.push("Not allocated yet.");
  for (const c of view.categories) {
    parts.push(
      `${c.label} ${c.percent}%: ${c.projected ? "would be credited" : "credited"} ${ethAmount(c.credit)}${!c.projected ? (c.withdrawn > 0n ? ", withdrawn" : ", not withdrawn") : ""}.`,
    );
  }
  parts.push(`The contract holds ${ethAmount(state.balance)}.`);
  return parts.join(" ");
}
