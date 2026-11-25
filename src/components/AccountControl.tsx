import { useId, useState } from "react";
import { DEMO_ACCOUNTS } from "../chain/accounts";
import { ethFixed, shortAddress } from "../app/format";
import { campaignRole } from "../app/model";
import { useBalances, useCampaign } from "../app/queries";
import { OPENED_FROM_FILE, useSession } from "../app/session";
import { explainError } from "../contract/fund";

export function AccountControl() {
  const s = useSession();
  const balances = useBalances();
  const campaign = useCampaign().data;
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);

  if (s.mode === "simulation") {
    if (!s.sim) return <span className="account account--loading">Starting chain</span>;
    const sim = s.sim;
    return (
      <div className="account">
        <label htmlFor={id} className="account__label">
          Acting as
        </label>
        <div className="select">
          <select id={id} value={sim.accountIndex} onChange={(e) => sim.setAccount(Number(e.target.value))}>
            {DEMO_ACCOUNTS.map((a) => (
              <option key={a.index} value={a.index}>
                {/* the account's part in the open campaign, not a fixed label */}
                {(() => {
                  const role = campaign ? campaignRole(a.address, campaign) : null;
                  return role ? `Account ${a.index}, ${role.replace(" recipient", "")}` : `Account ${a.index}`;
                })()}
              </option>
            ))}
          </select>
        </div>
        {balances.data?.[DEMO_ACCOUNTS[sim.accountIndex].address] !== undefined && (
          <span className="account__balance num" title="Balance of the acting account">
            {ethFixed(balances.data[DEMO_ACCOUNTS[sim.accountIndex].address], 4)} ETH
          </span>
        )}
      </div>
    );
  }

  const w = s.wallet!;
  if (w.wallets.length === 0) {
    return (
      <p className="account account--note">
        {OPENED_FROM_FILE
          ? "Browser wallets do not reach a page opened as a file. Start the app with npm start or a start script to use MetaMask; reading works here."
          : "No browser wallet found. Install MetaMask and reload to send transactions; reading works without one."}
      </p>
    );
  }
  const connected = s.account;
  return (
    <div className="account">
      {w.wallets.length > 1 && !connected && (
        <div className="select select--small">
          <select aria-label="Wallet" value={w.chosen?.id} onChange={(e) => w.choose(e.target.value)}>
            {w.wallets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {connected ? (
        <span className="account__connected">
          <span className="account__label">Connected</span>
          <span className="mono">{shortAddress(connected)}</span>
          {balances.data?.[connected] !== undefined && <span className="account__balance">{ethFixed(balances.data[connected], 4)} ETH</span>}
          {balances.data?.[connected] === 0n && (
            <a className="account__faucet" href="https://ethereum.org/en/developers/docs/networks/#sepolia" target="_blank" rel="noreferrer">
              No Sepolia ETH yet: find a faucet
            </a>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="btn btn--onbar"
          disabled={w.connecting}
          onClick={async () => {
            setProblem(null);
            try {
              await w.connect();
              // Asking for Sepolia when the wallet is already on it returns at once, with no prompt.
              await w.switchToSepolia();
            } catch (e) {
              setProblem(explainError(e));
            }
          }}
        >
          {w.connecting ? "Waiting for the wallet" : `Connect ${w.chosen?.name ?? "wallet"}`}
        </button>
      )}
      {!connected && w.chosen && !w.connecting && problem && <span className="account__problem">{problem}</span>}
    </div>
  );
}

/** Shown on Sepolia pages when the wallet is connected to another network. */
export function WrongNetworkNotice() {
  const s = useSession();
  const [problem, setProblem] = useState<string | null>(null);
  const w = s.wallet;
  // Only when a wallet is connected but on another network; "Connect" sits in the strip above.
  if (s.mode !== "sepolia" || !w || w.chainOk || !w.chosen || !w.connected) return null;
  return (
    <div className="notice notice--warn" role="status">
      <p>
        {w.chosen.name} is connected to another network. Reading works anyway; to send transactions, switch it to Sepolia (chain ID
        11155111).
      </p>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={async () => {
          setProblem(null);
          try {
            await w.connect();
            await w.switchToSepolia();
          } catch (e) {
            setProblem(explainError(e));
          }
        }}
      >
        Switch to Sepolia
      </button>
      {problem && <p className="field__error">{problem}</p>}
    </div>
  );
}
