import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { copyText } from "../app/format";
import { usePageTitle } from "../app/title";
import { compilerVersion, contractSource, fundBytecode } from "../contract/artifact";

export const Route = createFileRoute("/contract")({ component: ContractPage });

const KEYWORDS = /\b(pragma|solidity|contract|string|address|uint|bool|mapping|public|immutable|event|indexed|constructor|memory|require|function|external|payable|emit|return|true|false)\b/g;

/** Light syntax colouring: comments, strings, keywords. Escapes everything else. */
function highlight(line: string) {
  const out: (string | { cls: string; text: string })[] = [];
  const comment = line.indexOf("//");
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const parts = code.split(/("[^"]*")/);
  for (const part of parts) {
    if (/^"[^"]*"$/.test(part)) out.push({ cls: "tok-str", text: part });
    else {
      let last = 0;
      for (const m of part.matchAll(KEYWORDS)) {
        if (m.index! > last) out.push(part.slice(last, m.index));
        out.push({ cls: "tok-kw", text: m[0] });
        last = m.index! + m[0].length;
      }
      if (last < part.length) out.push(part.slice(last));
    }
  }
  if (comment >= 0) out.push({ cls: "tok-com", text: line.slice(comment) });
  return out.map((p, i) => (typeof p === "string" ? p : <span key={i} className={p.cls}>{p.text}</span>));
}

function ContractPage() {
  usePageTitle("Contract source");
  const [copied, setCopied] = useState(false);
  const lines = contractSource.replace(/\n$/, "").split("\n");
  return (
    <div className="source">
      <header className="source__head">
        <div>
          <h1>Contract source</h1>
          <p>
            DisasterReliefFund.sol, {lines.length} lines, as in the guide's appendix. This exact text is compiled into the contract this app
            deploys.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={async () => {
            if (await copyText(contractSource)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          {copied ? "Copied" : "Copy the source"}
        </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </span>
      </header>

      <dl className="settings" aria-label="Compiler settings and output">
        <div>
          <dt>Compiler</dt>
          <dd>Solidity {compilerVersion.split("+")[0]}</dd>
        </div>
        <div>
          <dt>Optimizer</dt>
          <dd>On, 200 runs</dd>
        </div>
        <div>
          <dt>EVM target</dt>
          <dd>Paris</dd>
        </div>
        <div>
          <dt>Compilation through IR</dt>
          <dd>Off</dd>
        </div>
        <div>
          <dt>Creation code</dt>
          <dd className="num">{((fundBytecode.length - 2) / 2).toLocaleString("en-US")} bytes</dd>
        </div>
      </dl>
      <p className="source__remix">
        The guide has you type this contract yourselves in{" "}
        <a href="https://app.remix.live" target="_blank" rel="noreferrer">
          Remix
        </a>{" "}
        in six stages; compare your own file with this text, and use the first four settings above in Remix's compiler.
      </p>

      <pre className="code" role="region" aria-label="Solidity source code" tabIndex={0}>
        <code>
          {lines.map((line, i) => (
            <span className="code__line" key={i}>
              <span className="code__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="code__t">{highlight(line)}</span>
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
