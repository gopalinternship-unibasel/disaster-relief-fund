import { useEffect, useState } from "react";
import { clockTime, duration } from "../app/format";
import { useCampaign, useChainClock } from "../app/queries";
import { useSession } from "../app/session";
import { AccountControl } from "./AccountControl";

export function SimulationStrip() {
  const s = useSession();
  const campaign = useCampaign();
  const now = useChainClock();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const sim = s.sim;
  const endTime = campaign.data?.endTime;
  const beforeDeadline = endTime !== undefined && now !== null && now < endTime;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="simstrip" aria-label="Simulation controls">
      <div className="simstrip__inner wrap">
        <AccountControl />
        <p className="simstrip__clock" aria-live="off">
          <span className="simstrip__label">Chain clock</span>
          <strong className="num">{now !== null ? clockTime(now) : "starting"}</strong>
          {endTime !== undefined && now !== null && (
            <span className="simstrip__rel">
              {beforeDeadline ? `deadline in ${duration(endTime - now)}` : `deadline passed ${duration(now - endTime)} ago`}
            </span>
          )}
        </p>
        <div className="simstrip__actions">
          <button
            type="button"
            className="btn btn--quiet"
            disabled={!sim || busy || !beforeDeadline}
            onClick={() => endTime !== undefined && sim && run(() => sim.jumpTo(endTime))}
            title="Moves the chain's clock to the deadline and mines a block there"
          >
            Skip to deadline
          </button>
          <button type="button" className="btn btn--quiet" disabled={!sim || busy} onClick={() => sim && run(() => sim.advance(60))}>
            Add 1 minute
          </button>
          <button
            type="button"
            className={confirmReset ? "btn btn--danger" : "btn btn--quiet"}
            disabled={!sim || busy}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              setConfirmReset(false);
              if (sim) run(() => sim.reset());
            }}
          >
            {confirmReset ? "Click again to reset" : "Reset simulation"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Sepolia: the wallet, its account and network, in the same place as the simulation controls. */
export function WalletStrip() {
  const s = useSession();
  const w = s.wallet;
  return (
    <section className="simstrip" aria-label="Wallet and network">
      <div className="simstrip__inner wrap">
        <AccountControl />
        <p className="simstrip__clock">
          <span className="simstrip__label">Network</span>
          <strong>Sepolia</strong>
          <span className="simstrip__rel">
            {w?.connected ? (w.chainOk ? "wallet connected, chain ID 11155111" : "wallet connected to another network") : "reading through a public endpoint; no wallet connected"}
          </span>
        </p>
      </div>
    </section>
  );
}
