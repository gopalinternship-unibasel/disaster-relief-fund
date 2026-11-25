# Disaster Relief Fund

One Solidity contract for one simulated flood relief campaign, built exactly as the step-by-step
guide describes (`contracts/DisasterReliefFund.sol`, 104 lines), and a web app to run it.

- Donors call `donate()` with test ETH before the deadline.
- At or after the deadline anyone calls `allocateFunds()` once. It records three credits (food and
  water, shelter, medical supplies) by the percentages fixed at deployment, and pays nobody.
- Each recipient calls `withdraw()` to receive its own credit.

The app shows where every wei of the campaign is, lets the selected account make its next call, and
checks each call against the contract before sending it, so a call the contract would reject shows
the contract's own reason and nothing is sent.

## Run it on any computer

If the folder came as a zip, extract all of it first (Windows: right-click, Extract All); a file
opened from inside a zip cannot find the rest of the app.

| What the computer has | What to do | What you get |
| --- | --- | --- |
| Only a web browser | Double-click `Disaster-Relief-Fund.html` | The whole app with a chain that runs inside the page: six test accounts, a clock you can move forward. Works offline. |
| Node.js | Windows: double-click `start-windows.bat`. macOS: double-click `start-mac.command`. Linux: in a terminal in the folder, `sh start-linux.sh`. Or anywhere: `npm start` | The same app at http://127.0.0.1:4173 (the next free port if that one is taken). Use this for MetaMask and Sepolia. Ctrl+C in the window stops it. |
| Node.js 22.12 or later (or 24) | `npm install`, then `npm run dev`, `npm test`, `npm run build` | Development: change the app or the contract and test it. |

The one file and `npm start` need no `npm install` and no internet connection for the simulation;
`npm start` uses only Node's own modules and was run with Node 24. The page needs a browser from
2021 or later (Chrome or Edge 93, Firefox 92, Safari 15.4); it was checked in Microsoft Edge and
Brave on Windows.

### Which mode to use

- **Simulation** (the default). A chain inside the page runs the real compiled contract on the
  Ethereum Foundation's EVM (`@ethereumjs/vm`). Six accounts with 100 test ETH each play the roles
  of the guide's section 4: Account 0 organizer, Accounts 1 to 3 the food and water, shelter and
  medical supplies recipients, Account 4 a second donor, Account 5 an unrelated wallet. Pick the
  acting account at the top. "Skip to deadline" moves the chain's clock; gas is charged at 1 gwei,
  so a recipient's balance rises by its credit minus its fee. Reload or "Reset simulation" starts
  again with the guide's campaign (40/35/25, 10 minutes). The accounts' keys are publicly known:
  never send real or Sepolia ETH to them.
- **Sepolia**. Uses MetaMask (or another browser wallet) for signing. Open the app with `npm start`,
  a start script or a web address, not by double-clicking the HTML file: browser extensions do not
  reach pages opened from a file unless you allow file access in the extension's settings. Then:
  1. Choose Sepolia at the top and click Connect. Approve the switch to Sepolia (chain ID 11155111).
  2. Deploy a campaign under New campaign, or use "Open another campaign" on the Campaign page to
     open one your team deployed. Save the contract address with your records.
  3. Every account that sends a transaction needs Sepolia test ETH for gas, recipients included.

  Reading works without a wallet: the app reads Sepolia through a public endpoint
  (`gateway.tenderly.co/public/sepolia`) and falls back to the wallet's own endpoint. A campaign can
  be shared as a link: `…/#/?contract=0x…&from=<deployment block>`; the link opens Sepolia mode,
  checks that the address is a DisasterReliefFund, and looks the block up if `from` is missing.
  On Sepolia a call that passes the check can still revert if another transaction changes the
  contract first (for example two people allocating in the same block); the app then shows the
  reason and the gas fee paid.

## Pages

- **Campaign**: the campaign's state, its four stages, the recipients' credits, a diagram of where
  the money is (drawn to scale), every event with the running balance, and the acting account's
  next step.
- **New campaign**: the eight constructor inputs in the constructor's order (as Remix lists them),
  checked with the contract's own rules and messages before anything is sent, with a preview of the
  credits.
- **Test checklist**: the guide's table of important test results (section 15, 20 rows), five
  checks from its other sections (60/25/15 proportions, 101 wei at 33/33/34, allocation at exactly
  the deadline, the section 12 to 14 walkthrough, a plain ETH transfer without `donate()`) and two
  payment-safety checks (a recipient that refuses ETH, and one that calls `withdraw()` again while
  being paid). Each row runs on its own fresh chain. "Copy as a Markdown table" copies the results
  with the caller and the simulation's transaction hashes, as section 15 asks to record.
- **Contract source**: the contract as compiled, with the compiler settings, to compare with the
  file you typed in Remix.

## Tests

```
npm test
```

runs 61 tests with Vitest:

- the 27 checks of the Test checklist page, on the real compiled contract;
- 10 tests of the in-browser chain (accounts and keys, clock, gas and gas estimates, refused
  transactions, event paging, deployment-block search, the split arithmetic); most deploy the real
  contract, a few test the app's own helpers;
- 24 mutation tests: 23 each break the contract in one way (for example `<` turned into `<=` at the
  deadline, the credit cleared after the payment instead of before, or the deadline counted in
  seconds instead of minutes), compile that copy, and check that the matching check now fails for
  the intended reason; one more checks that every mutation names a real check.

## Compiler settings

`npm run compile` compiles with the official `solc` package (WebAssembly, so it works on any
platform) using the guide's Remix settings: Solidity 0.8.30, optimizer on with 200 runs, EVM target
Paris, compilation through IR off. It writes `src/contract/artifact.ts`; `npm run build` recompiles
only when the contract source changed. In Remix (https://app.remix.live) choose the same four
settings.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Serves the built app from `dist/` and opens it (no dependencies needed). `-- --port 8080` picks a port, `-- --no-open` opens no browser |
| `npm run dev` | Development server at http://localhost:5174 |
| `npm test` | All tests |
| `npm run build` | Compiles if needed, type-checks, builds `dist/` and the one file `Disaster-Relief-Fund.html` |
| `npm run build:artifact` | The hosted-preview copy in `dist-artifact/` (simulation only) |
| `npm run compile` | Compiles the contracts into `src/contract/artifact.ts` |
| `npm run typecheck` | Type-checks the app and the tests |

`dist/` can also go on any static web host (GitHub Pages, Netlify, a university web space): the app
uses relative paths and `#` addresses, so it works from any sub-folder.

## Project layout

```
contracts/DisasterReliefFund.sol        the contract (as in the guide's appendix)
contracts/test-helpers/                 two recipient contracts used only by the safety checks
scripts/compile.mjs                     compiles with solc 0.8.30 and writes the artifact
scripts/serve.mjs                       npm start: a small static server, no dependencies
scripts/finish-single.mjs               checks and copies the one-file build
scripts/build-artifact.mjs              builds the hosted-preview copy
src/chain/local-chain.ts                the chain that runs inside the page
src/chain/accounts.ts                   the six simulation accounts and their roles
src/contract/fund.ts                    deploy, read, events, calls, error messages
src/checks/guide-checks.ts              the Test checklist (also run by npm test)
src/app/                                network session, queries, formatting, page model
src/components/, src/routes/            the pages (TanStack Router, Query, Form and Table)
tests/                                  Vitest tests, including the mutation tests
Disaster-Relief-Fund.html               the one-file build
dist/                                   the site build
DESIGN.md                               the design decisions
```

## If something goes wrong

| What you see | What to do |
| --- | --- |
| A page with only "Starting the Disaster Relief Fund…" | You opened `index.html` or `dist/index.html`, which need a server. Open `Disaster-Relief-Fund.html`, or run `npm start`. A browser older than those listed above shows the same. |
| `npm` or `node` is not recognised | Install Node.js (LTS) from https://nodejs.org, open a new terminal, try again. Or use the one file. |
| Windows PowerShell: "running scripts is disabled on this system" | Use `start-windows.bat`, or run `npm.cmd start`. |
| macOS: "start-mac.command cannot be opened" | Open System Settings, Privacy & Security, and choose Open Anyway for it (older macOS: right-click, Open). If it says you lack permission (the file lost its executable flag in a zip), run `sh start-mac.command` in Terminal in the folder. |
| Linux: double-clicking the script opens a text editor | Run `sh start-linux.sh` in a terminal in the folder. |
| Sepolia: "Browser wallets do not reach a page opened as a file" | Start the app with `npm start` or a start script, then open the address it prints. |
| Sepolia: "This account does not have enough ETH…" | Get Sepolia test ETH for that account from a faucet (see ethereum.org, Networks). |
| Sepolia: allocation still says "Fundraising still open" just after the deadline | The chain's newest block is still before the deadline; blocks come every 12 seconds. |

## Limits of this classroom version

These come from the contract as the guide specifies it: there is no target and no refund; the
organizer chooses the recipients and percentages once, at deployment; a recipient that cannot
receive ETH (or whose key is lost) leaves its credit in the contract, without blocking the others;
the contract cannot verify the disaster, the charities or what they do with the money. It has not
had a security audit.
