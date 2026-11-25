import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { HOSTED_PREVIEW, NetworkSwitch } from "../components/NetworkSwitch";
import { SimulationStrip, WalletStrip } from "../components/SimulationStrip";
import { ThemeToggle } from "../components/ThemeToggle";
import { useSession } from "../app/session";
import { compilerVersion } from "../contract/artifact";

export const Route = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });

function NotFound() {
  return (
    <section className="emptystate">
      <h1>This page does not exist</h1>
      <p>The address may be mistyped, or it comes from an older version of the app.</p>
      <div className="emptystate__actions">
        <Link to="/" className="btn btn--primary">
          Go to the campaign
        </Link>
      </div>
    </section>
  );
}

const NAV = [
  { to: "/", label: "Campaign" },
  { to: "/new", label: "New campaign" },
  { to: "/checks", label: "Test checklist" },
  { to: "/contract", label: "Contract source" },
] as const;

function RootLayout() {
  const s = useSession();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const quietPage = path === "/checks" || path === "/contract";
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // The app routes with the address's # part, so move focus without changing it.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar__inner wrap">
          <Link to="/" className="brand" aria-label="Disaster Relief Fund, campaign page">
            <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="1" y="1" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M5 20c3.2 0 3.2-2.6 6.4-2.6s3.2 2.6 6.4 2.6 3.2-2.6 6.4-2.6c1.4 0 2.2.5 2.8 1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M16 6v8M12.5 10.5 16 14l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Disaster Relief Fund</span>
          </Link>
          <nav className="mainnav" aria-label="Main">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className="mainnav__link" activeOptions={{ exact: true }} activeProps={{ "aria-current": "page" }}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar__tools">
            <NetworkSwitch />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {/* The acting account and the clock matter for the campaign and for deploying, not for the
          checklist (each check runs on its own chain) or the source page. */}
      {!quietPage && (s.mode === "simulation" ? <SimulationStrip /> : <WalletStrip />)}
      <main id="main" className="page wrap" tabIndex={-1}>
        {s.error ? (
          <div className="notice notice--error" role="alert">
            {s.error}
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <footer className="footer wrap">
        <p>
          Contract compiled with Solidity {compilerVersion.split("+")[0]}, optimizer on with 200 runs, EVM target Paris.
          {s.mode === "simulation" ? " Test ETH only: the six simulation accounts use publicly known keys." : " Sepolia test ETH only."}
          {HOSTED_PREVIEW && " This hosted copy runs the simulation only; for Sepolia with MetaMask, run the project folder with npm start."}
        </p>
      </footer>
    </>
  );
}
