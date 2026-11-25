import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { ActivityTable, CampaignHeader, Lifecycle, RecipientsTable } from "../components/CampaignParts";
import { MoneyStage } from "../components/MoneyStage";
import { NextStep } from "../components/NextStep";
import { WrongNetworkNotice } from "../components/AccountControl";
import { viewOf } from "../app/model";
import { useCampaign, useChainClock, useEvents } from "../app/queries";
import { useSession } from "../app/session";
import { explainError, findDeploymentBlock, looksLikeFund } from "../contract/fund";
import { usePageTitle } from "../app/title";

type Search = { contract?: string; from?: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    contract: typeof search.contract === "string" ? search.contract : undefined,
    from: typeof search.from === "string" || typeof search.from === "number" ? String(search.from) : undefined,
  }),
  component: CampaignPage,
});

function CampaignPage() {
  const s = useSession();
  const search = Route.useSearch();
  const campaign = useCampaign();
  const events = useEvents();
  const now = useChainClock();

  usePageTitle(campaign.data?.campaignName || "Campaign");

  // A shared link (#/?contract=0x...&from=123) opens that Sepolia campaign, switching to Sepolia
  // first. The address is checked before it is remembered, and a missing block is looked up.
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  useEffect(() => {
    if (!search.contract) return;
    if (!isAddress(search.contract)) {
      setLinkProblem(`The link's contract address "${search.contract}" is not a valid address.`);
      return;
    }
    if (s.mode !== "sepolia") {
      s.setMode("sepolia");
      return;
    }
    const address = getAddress(search.contract);
    if (s.campaign?.address === address || !s.publicClient) return;
    let alive = true;
    const client = s.publicClient;
    setLinkBusy(true);
    (async () => {
      try {
        if (!(await looksLikeFund(client, address))) {
          if (alive) setLinkProblem(`The shared link points at ${address}, which is not a DisasterReliefFund on Sepolia.`);
          return;
        }
        const known = s.campaigns.find((c) => c.address === address)?.fromBlock;
        const fromLink = search.from && /^\d+$/.test(search.from) ? BigInt(search.from) : undefined;
        const fromBlock = fromLink ?? known ?? (await findDeploymentBlock(client, address)) ?? 0n;
        if (alive) {
          setLinkProblem(null);
          s.selectCampaign({ address, fromBlock });
        }
      } catch (e) {
        if (alive) setLinkProblem(`Could not open the shared link: ${explainError(e)}`);
      } finally {
        if (alive) setLinkBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-style exhaustive deps are not wanted here: the session object changes on every render
  }, [s.mode, s.publicClient, search.contract, search.from]);

  if (linkBusy) return <Loading text="Opening the shared campaign" />;

  if (s.starting) return <Loading text="Starting the in-browser chain and deploying the guide's campaign" />;

  const linkNotice = linkProblem && (
    <div className="notice notice--error" role="alert">
      <p>{linkProblem}</p>
    </div>
  );

  if (!s.campaign) {
    return (
      <>
        {linkNotice}
        <WrongNetworkNotice />
        <section className="emptystate">
          <h1>No campaign open on Sepolia</h1>
          <p>
            Every account that sends a transaction needs Sepolia test ETH for gas, the three recipients included. Faucets are listed on{" "}
            <a href="https://ethereum.org/en/developers/docs/networks/#sepolia" target="_blank" rel="noreferrer">
              ethereum.org
            </a>
            .
          </p>
          <p>
            One contract is one campaign. Deploy a new one from MetaMask, or open a contract your team already deployed by pasting its
            address.
          </p>
          <div className="emptystate__actions">
            <Link to="/new" className="btn btn--primary">
              Deploy a campaign
            </Link>
            <Link to="/open" className="btn btn--secondary">
              Open a deployed contract
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (campaign.isError && !campaign.data) {
    return (
      <div className="notice notice--error" role="alert">
        <p>Could not read the contract at {s.campaign.address}: {explainError(campaign.error)}</p>
        <p>
          Check that the address belongs to a DisasterReliefFund on this network. <Link to="/open">Open another contract</Link>
        </p>
      </div>
    );
  }

  if (!campaign.data || now === null) return <Loading text="Reading the contract" />;

  const state = campaign.data;
  // Without a loaded history the page says so, instead of showing zero donations.
  const view = viewOf(state, events.isError && !events.data ? undefined : events.data, now);
  // On Sepolia the connected wallet is "You"; in the simulation every account has its own name.
  const sepoliaYou = s.mode === "sepolia" ? s.account : null;

  return (
    <>
      {linkNotice}
      <WrongNetworkNotice />
      <div className="campaign">
        <div className="campaign__main">
          <div className="campaign__a">
            <CampaignHeader state={state} view={view} now={now} deployBlock={s.campaign.fromBlock} />
            <Lifecycle state={state} view={view} now={now} deployBlock={s.campaign.fromBlock} />
          </div>
          <div className="campaign__b">
            <RecipientsTable state={state} view={view} />
          </div>
        </div>
        <div className="campaign__side">
          <NextStep state={state} view={view} now={now} />
        </div>
        <div className="campaign__wide campaign__stage">
          <MoneyStage state={state} view={view} you={sepoliaYou} />
        </div>
        <div className="campaign__wide campaign__activity">
          <ActivityTable events={events.data ?? []} loading={events.isLoading} error={events.isError ? explainError(events.error) : null} />
        </div>
      </div>
    </>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <p className="loading" role="status">
      <span className="loading__bar" aria-hidden="true" />
      {text}
    </p>
  );
}
