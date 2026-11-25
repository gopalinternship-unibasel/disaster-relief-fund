import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getAddress, isAddress, parseEther, type Address } from "viem";
import { DEMO_ACCOUNTS } from "../chain/accounts";
import { WrongNetworkNotice } from "../components/AccountControl";
import { ETHERSCAN, accountName, eth, shortAddress } from "../app/format";
import { useSession } from "../app/session";
import { usePageTitle } from "../app/title";
import { MAX_UINT, constructorProblem, explainError, splitTotal, type DeployArgs } from "../contract/fund";

export const Route = createFileRoute("/new")({ component: NewCampaign });

type Values = {
  campaignName: string;
  foodRecipient: string;
  shelterRecipient: string;
  medicalRecipient: string;
  durationMinutes: string;
  foodPercent: string;
  shelterPercent: string;
  medicalPercent: string;
};

const ZERO = "0x0000000000000000000000000000000000000000";
const wholeNumber = (v: string) => /^\d+$/.test(v.trim());

function addressProblem(v: string): string | undefined {
  const t = v.trim();
  if (!t) return "Enter a wallet address.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return "An address is 0x followed by 40 hexadecimal characters.";
  if (!isAddress(t)) return "The capital letters do not match the address checksum. Paste it again, or use all lower case.";
  if (t.toLowerCase() === ZERO) return "The contract rejects the zero address: Zero recipient.";
  return undefined;
}
function percentProblem(v: string): string | undefined {
  if (!wholeNumber(v)) return "Whole numbers only, for example 40 (not 0.40).";
  if (BigInt(v.trim()) === 0n) return "Each share must be at least 1: Percentages must be positive.";
  if (BigInt(v.trim()) > MAX_UINT) return "Too large for a uint.";
  return undefined;
}
function durationProblem(v: string): string | undefined {
  if (!wholeNumber(v)) return "Whole minutes only, for example 10.";
  if (BigInt(v.trim()) === 0n) return "The contract rejects 0: Duration must be positive.";
  if (BigInt(v.trim()) > MAX_UINT) return "Too large for a uint.";
  return undefined;
}

function toArgs(v: Values): DeployArgs | null {
  if ([v.foodRecipient, v.shelterRecipient, v.medicalRecipient].some((a) => addressProblem(a))) return null;
  if (![v.durationMinutes, v.foodPercent, v.shelterPercent, v.medicalPercent].every(wholeNumber)) return null;
  return {
    campaignName: v.campaignName,
    foodRecipient: getAddress(v.foodRecipient.trim()),
    shelterRecipient: getAddress(v.shelterRecipient.trim()),
    medicalRecipient: getAddress(v.medicalRecipient.trim()),
    durationMinutes: BigInt(v.durationMinutes.trim()),
    foodPercent: BigInt(v.foodPercent.trim()),
    shelterPercent: BigInt(v.shelterPercent.trim()),
    medicalPercent: BigInt(v.medicalPercent.trim()),
  };
}

const RECIPIENTS = [
  { name: "foodRecipient", position: 2, label: "Food and water wallet" },
  { name: "shelterRecipient", position: 3, label: "Shelter wallet" },
  { name: "medicalRecipient", position: 4, label: "Medical supplies wallet" },
] as const;
const SHARES = [
  { name: "foodPercent", position: 6, label: "Food and water share" },
  { name: "shelterPercent", position: 7, label: "Shelter share" },
  { name: "medicalPercent", position: 8, label: "Medical supplies share" },
] as const;

function NewCampaign() {
  const s = useSession();
  const navigate = useNavigate();
  const sim = s.mode === "simulation";
  const [sendError, setSendError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<{ address: Address; hash: string } | null>(null);
  usePageTitle("New campaign");

  const form = useForm({
    defaultValues: {
      campaignName: "Flood relief simulation",
      foodRecipient: sim ? DEMO_ACCOUNTS[1].address : "",
      shelterRecipient: sim ? DEMO_ACCOUNTS[2].address : "",
      medicalRecipient: sim ? DEMO_ACCOUNTS[3].address : "",
      durationMinutes: "10",
      foodPercent: "40",
      shelterPercent: "35",
      medicalPercent: "25",
    } as Values,
    onSubmit: async ({ value }) => {
      setSendError(null);
      const args = toArgs(value);
      if (!args) return;
      try {
        const result = await s.deploy(args);
        setDeployed({ address: result.address, hash: result.hash });
        if (sim) navigate({ to: "/" });
      } catch (e) {
        setSendError(explainError(e));
      }
    },
  });

  const canSign = Boolean(s.account && s.walletClient);

  return (
    <div className="formpage">
      <WrongNetworkNotice />
      <header className="formpage__head">
        <h1>Deploy a new campaign</h1>
        <p>
          The constructor takes eight values, and the fields below follow its order, as Remix lists them. The contract checks them before
          it exists, and nothing can change afterwards: the addresses, shares and deadline are immutable. The deadline starts at deployment.
        </p>
      </header>

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <fieldset className="form__group">
          <legend>Campaign</legend>
          <form.Field name="campaignName">
            {(field) => (
              <div className="field">
                <label className="field__label" htmlFor={field.name}>
                  <span>1. _campaignName</span>
                  <span className="field__plain">Campaign name</span>
                </label>
                <input
                  id={field.name}
                  className="input"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-describedby={`${field.name}-msg`}
                />
                <p id={`${field.name}-msg`} className="field__help">
                  Any text. Another disaster gets another deployment with its own name.
                </p>
              </div>
            )}
          </form.Field>
        </fieldset>

        <fieldset className="form__group">
          <legend>Recipients</legend>
          <p className="form__groupnote">Three different wallets, one per purpose. The zero address is rejected.</p>
          {RECIPIENTS.map((r) => (
            <form.Field key={r.name} name={r.name} validators={{ onChange: ({ value }) => addressProblem(value) }}>
              {(field) => (
                <div className="field">
                  <label className="field__label" htmlFor={field.name}>
                    <span>
                      {r.position}. _{r.name}
                    </span>
                    <span className="field__plain">{r.label}</span>
                  </label>
                  <input
                    id={field.name}
                    className="input mono"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={field.state.meta.errors.length > 0 ? `${field.name}-msg` : undefined}
                  />
                  <FieldMessage id={`${field.name}-msg`} errors={field.state.meta.errors} />
                  {sim && (
                    <div className="pickers" role="group" aria-label={`Fill the ${r.label.toLowerCase()} with a simulation account`}>
                      {DEMO_ACCOUNTS.map((a) => (
                        <button key={a.index} type="button" className="btn btn--chip" aria-pressed={field.state.value === a.address} onClick={() => field.handleChange(a.address)}>
                          Account {a.index}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </form.Field>
          ))}
        </fieldset>

        <fieldset className="form__group">
          <legend>Deadline and shares</legend>
          <form.Field name="durationMinutes" validators={{ onChange: ({ value }) => durationProblem(value) }}>
            {(field) => (
              <div className="field field--short">
                <label className="field__label" htmlFor={field.name}>
                  <span>5. _durationMinutes</span>
                  <span className="field__plain">Fundraising period in minutes</span>
                </label>
                <input
                  id={field.name}
                  className="input num"
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-msg`}
                />
                <FieldMessage id={`${field.name}-msg`} errors={field.state.meta.errors} help="10 for a first practice, 2 for a quick repeat." />
              </div>
            )}
          </form.Field>
          <p className="form__groupnote">Whole-number shares, each at least 1, adding up to exactly 100. Write 40, not 0.40.</p>
          <div className="shares">
            {SHARES.map((sh) => (
              <form.Field key={sh.name} name={sh.name} validators={{ onChange: ({ value }) => percentProblem(value) }}>
                {(field) => (
                  <div className="field">
                    <label className="field__label" htmlFor={field.name}>
                      <span>
                        {sh.position}. _{sh.name}
                      </span>
                      <span className="field__plain">{sh.label}</span>
                    </label>
                    <div className="input-affix">
                      <input
                        id={field.name}
                        className="input num"
                        inputMode="numeric"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby={field.state.meta.errors.length > 0 ? `${field.name}-msg` : undefined}
                      />
                      <span aria-hidden="true">%</span>
                    </div>
                    <FieldMessage id={`${field.name}-msg`} errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            ))}
          </div>
          <form.Subscribe selector={(st) => st.values}>{(values) => <Preview values={values} />}</form.Subscribe>
        </fieldset>

        {sendError && (
          <div className="notice notice--error" role="alert">
            <p>Not deployed: {sendError}</p>
          </div>
        )}
        {deployed && !sim && (
          <div className="notice notice--done" role="status">
            <p>
              Deployed at <span className="mono">{deployed.address}</span>.{" "}
              <a href={`${ETHERSCAN}/tx/${deployed.hash}`} target="_blank" rel="noreferrer">
                Deployment on Etherscan
              </a>
              . Save the address with your team's records. <Link to="/">Open the campaign</Link>
            </p>
          </div>
        )}

        <form.Subscribe selector={(st) => [st.isSubmitting, st.values] as const}>
          {([submitting, values]) => {
            const args = toArgs(values);
            const problem = args ? constructorProblem(args) : null;
            return (
              <div className="form__submit">
                <button type="submit" className="btn btn--go" disabled={submitting || !canSign || !args || Boolean(problem)}>
                  {submitting
                    ? sim
                      ? "Deploying"
                      : "Confirm in your wallet"
                    : sim
                      ? `Deploy from ${s.account ? accountName(s.account) : "the acting account"}`
                      : `Deploy with ${s.wallet?.chosen?.name ?? "your wallet"}`}
                </button>
                <p className="field__help">
                  {!canSign
                    ? "Connect a wallet on Sepolia to deploy. The deploying address becomes the creator."
                    : !args
                      ? "Fix the fields marked in red to deploy."
                      : problem
                        ? `The constructor would reject these values: ${problem}.`
                        : sim
                          ? `Deploys from ${accountName(s.account!)} with transaction value 0; that account becomes the creator. Choose the acting account at the top.`
                          : `Deploys from ${shortAddress(s.account!)} with transaction value 0. The constructor is not payable.`}
                </p>
              </div>
            );
          }}
        </form.Subscribe>
      </form>
    </div>
  );
}

function FieldMessage({ id, errors, help }: { id: string; errors: unknown[]; help?: string }) {
  const first = errors.find((e) => typeof e === "string") as string | undefined;
  if (first)
    return (
      <p id={id} className="field__error">
        {first}
      </p>
    );
  return help ? (
    <p id={id} className="field__help">
      {help}
    </p>
  ) : null;
}

function Preview({ values }: { values: Values }) {
  const pcts = [values.foodPercent, values.shelterPercent, values.medicalPercent];
  const valid = pcts.every((p) => wholeNumber(p) && BigInt(p.trim()) > 0n && BigInt(p.trim()) <= 100n);
  const sum = valid ? pcts.reduce((a, p) => a + BigInt(p.trim()), 0n) : null;
  const split = valid ? splitTotal(parseEther("0.01"), BigInt(values.foodPercent.trim()), BigInt(values.shelterPercent.trim())) : null;
  const odd = valid ? splitTotal(101n, BigInt(values.foodPercent.trim()), BigInt(values.shelterPercent.trim())) : null;
  return (
    <section className="preview" aria-live="polite" aria-label="What these shares would credit">
      {sum === null ? (
        <p className="preview__sum">The total shows once each share is a whole number from 1 to 100.</p>
      ) : (
        <p className={`preview__sum${sum !== 100n ? " is-bad" : ""}`}>
          Shares add up to <strong className="num">{sum.toString()}</strong>
          {sum !== 100n ? ": the contract needs exactly 100 (Percentages must total 100)." : ", as the contract requires."}
        </p>
      )}
      {split && sum === 100n && odd && (
        <p>
          A total of 0.01 ETH would be credited as food and water {eth(split.food)}, shelter {eth(split.shelter)} and medical supplies {eth(split.medical)} ETH.
          With 101 wei: {odd.food.toString()}, {odd.shelter.toString()} and {odd.medical.toString()} wei, because the medical share takes what rounding leaves.
        </p>
      )}
    </section>
  );
}
