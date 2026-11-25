import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { shortAddress } from "../app/format";
import { useSession } from "../app/session";
import { usePageTitle } from "../app/title";
import { explainError, findDeploymentBlock, looksLikeFund } from "../contract/fund";

export const Route = createFileRoute("/open")({ component: OpenCampaign });

function OpenCampaign() {
  usePageTitle("Open a campaign");
  const s = useSession();
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [fromBlock, setFromBlock] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setProblem(null);
    const a = address.trim();
    if (!isAddress(a)) return setProblem("Paste the contract address: 0x followed by 40 hexadecimal characters.");
    if (fromBlock.trim() && !/^\d+$/.test(fromBlock.trim())) return setProblem("The deployment block is a whole number, as Etherscan shows it.");
    if (!s.publicClient) return setProblem("Not connected to the network yet. Try again in a moment.");
    setBusy(true);
    try {
      const checksummed = getAddress(a);
      setStatus("Checking the contract");
      if (!(await looksLikeFund(s.publicClient, checksummed))) {
        setProblem(`There is no DisasterReliefFund at ${shortAddress(checksummed)} on ${s.mode === "sepolia" ? "Sepolia" : "this simulation"}.`);
        return;
      }
      let block: bigint | null = fromBlock.trim() ? BigInt(fromBlock.trim()) : null;
      if (block === null) {
        setStatus("Finding the deployment block, so the history starts there");
        block = await findDeploymentBlock(s.publicClient, checksummed);
      }
      if (block === null) {
        setProblem("This node cannot look up old blocks. Enter the deployment block from the contract's Etherscan page.");
        return;
      }
      s.selectCampaign({ address: checksummed, fromBlock: block });
      navigate({ to: "/" });
    } catch (e) {
      setProblem(explainError(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <div className="formpage">
      <header className="formpage__head">
        <h1>Open a deployed campaign</h1>
        <p>
          {s.mode === "sepolia"
            ? "Use the address your team saved after deployment. Reading needs no wallet."
            : "Campaigns deployed in this simulation. Reset or reload, and they are gone: the chain lives in this page."}
        </p>
      </header>

      {s.campaigns.length > 0 && (
        <section className="block">
          <h2>{s.mode === "sepolia" ? "Opened in this browser" : "In this simulation"}</h2>
          <ul className="camplist">
            {s.campaigns.map((c) => (
              <li key={c.address} className="camplist__item">
                <div>
                  <p className="camplist__name">{c.name ?? "Campaign"}</p>
                  <p className="mono camplist__addr">{c.address}</p>
                </div>
                <div className="camplist__actions">
                  {s.campaign?.address === c.address ? (
                    <span className="camplist__current">Shown now</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => {
                        s.selectCampaign(c);
                        navigate({ to: "/" });
                      }}
                    >
                      Show
                    </button>
                  )}
                  {s.mode === "sepolia" && (
                    <button type="button" className="linkbtn" onClick={() => s.forgetCampaign(c.address)}>
                      Forget
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
      >
        <fieldset className="form__group">
          <legend>Open by address</legend>
          <div className="field">
            <label className="field__label" htmlFor="open-address">
              Contract address
            </label>
            <input id="open-address" className="input mono" spellCheck={false} autoComplete="off" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field field--short">
            <label className="field__label" htmlFor="open-block">
              Deployment block <span className="field__plain">optional</span>
            </label>
            <input id="open-block" className="input num" inputMode="numeric" value={fromBlock} onChange={(e) => setFromBlock(e.target.value)} aria-describedby="open-block-help" />
            <p id="open-block-help" className="field__help">
              Left empty, it is looked up. The activity list starts at this block.
            </p>
          </div>
        </fieldset>
        {problem && (
          <p className="field__error" role="alert">
            {problem}
          </p>
        )}
        <div className="form__submit">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? status ?? "Opening" : "Open the campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
