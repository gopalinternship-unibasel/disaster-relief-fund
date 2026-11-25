import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { copyText } from "../app/format";
import { usePageTitle } from "../app/title";
import { CHECKS, runCheck, type Check, type CheckRun } from "../checks/guide-checks";

export const Route = createFileRoute("/checks")({ component: ChecksPage });

const COUNT = {
  table: CHECKS.filter((c) => c.source === "Guide table").length,
  text: CHECKS.filter((c) => c.source === "Guide text").length,
  safety: CHECKS.filter((c) => c.source === "Security").length,
};

type Row = { check: Check; index: number; run?: CheckRun; running: boolean };
const features = tableFeatures({});
const CHECK_LABELS: Record<string, string> = { n: "Row", test: "Test", expected: "Expected result", actual: "Actual result", result: "Result" };
const col = createColumnHelper<typeof features, Row>();

function ChecksPage() {
  usePageTitle("Test checklist");
  const [runs, setRuns] = useState<Record<string, CheckRun>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runAll = async () => {
    setRuns({});
    for (const check of CHECKS) {
      setRunning(check.id);
      const result = await runCheck(check);
      setRuns((r) => ({ ...r, [check.id]: result }));
    }
    setRunning(null);
  };

  const done = Object.values(runs);
  const passed = done.filter((r) => r.pass).length;
  const data: Row[] = CHECKS.map((check, index) => ({ check, index, run: runs[check.id], running: running === check.id }));

  const columns = col.columns([
    col.accessor((r) => r.index + 1, { id: "n", header: "Row", cell: (i) => <span className="num">{i.getValue()}</span> }),
    col.accessor((r) => r.check.test, {
      id: "test",
      header: "Test",
      cell: (i) => (
        <span className="check__test">
          {i.getValue()}
          <span className="check__source">
            {i.row.original.check.source === "Guide table" ? "Guide, section 15" : i.row.original.check.source === "Guide text" ? "Guide, other sections" : "Payment safety"}.
            Caller: {i.row.original.check.caller}
          </span>
        </span>
      ),
    }),
    col.accessor((r) => r.check.expected, { id: "expected", header: "Expected result" }),
    col.display({
      id: "actual",
      header: "Actual result",
      cell: (i) => {
        const r = i.row.original;
        if (r.running) return <span className="check__pending">Running</span>;
        return r.run ? r.run.actual : <span className="check__pending">Not run</span>;
      },
    }),
    col.display({
      id: "result",
      header: "Result",
      cell: (i) => {
        const r = i.row.original.run;
        if (!r) return null;
        return <span className={r.pass ? "verdict verdict--pass" : "verdict verdict--fail"}>{r.pass ? "Pass" : "Fail"}</span>;
      },
    }),
  ]);
  const table = useTable({ features, columns, data });

  const copyMarkdown = async () => {
    const lines = [
      "| Row | Test | Caller | Expected result | Actual result | Result | Transactions (simulation chain) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ];
    CHECKS.forEach((c, i) => {
      const r = runs[c.id];
      const esc = (t: string) => t.replace(/\|/g, "\\|");
      const txs = r ? r.txs.map((h) => `${h.slice(0, 10)}…`).join(" ") : "";
      lines.push(`| ${i + 1} | ${esc(c.test)} | ${esc(c.caller)} | ${esc(c.expected)} | ${esc(r?.actual ?? "not run")} | ${r ? (r.pass ? "Pass" : "Fail") : ""} | ${txs} |`);
    });
    if (await copyText(lines.join("\n"))) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }
  };

  return (
    <div className="checks">
      <header className="checks__head">
        <div>
          <h1>Test checklist</h1>
          <p>
            The guide's table of important test results ({COUNT.table} rows), {COUNT.text} checks from its other sections and{" "}
            {COUNT.safety} payment-safety checks. Each row runs on its own fresh in-browser chain with the real compiled contract, so the
            main campaign is not touched. The same list runs in the automated tests (npm test).
          </p>
        </div>
        <div className="checks__actions">
          <button type="button" className="btn btn--go" onClick={runAll} disabled={running !== null}>
            {running !== null ? `Running ${done.length + 1} of ${CHECKS.length}` : done.length ? "Run all checks again" : `Run all ${CHECKS.length} checks`}
          </button>
          <button type="button" className="btn btn--secondary" onClick={copyMarkdown} disabled={done.length === 0 || running !== null}>
            {copied ? "Copied" : "Copy as a Markdown table"}
          </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </span>
        </div>
      </header>

      <p className="checks__tally" aria-live={running !== null ? "off" : "polite"}>
        {done.length === 0 ? `${CHECKS.length} checks, not run yet.` : `${passed} of ${done.length} passed${done.length < CHECKS.length ? `, ${CHECKS.length - done.length} still to run` : ""}.`}
      </p>

      <div className="tablewrap">
        <table className="table table--checks table--stack">
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id} scope="col">
                    {h.isPlaceholder ? null : <table.FlexRender header={h} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={row.original.run && !row.original.run.pass ? "is-fail" : undefined}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} data-label={CHECK_LABELS[cell.column.id]}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="block__foot">
        A rejected call is checked before sending, as on Sepolia when MetaMask estimates gas, so no transaction is mined for it. On a live
        network a mined transaction that reverts still costs gas.
      </p>
    </div>
  );
}
