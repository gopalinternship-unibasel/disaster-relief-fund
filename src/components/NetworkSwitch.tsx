import { useNavigate } from "@tanstack/react-router";
import { useSession, type NetworkMode } from "../app/session";

const OPTIONS: { mode: NetworkMode; label: string; hint: string }[] = [
  { mode: "simulation", label: "Simulation", hint: "A chain inside this page, six test accounts" },
  { mode: "sepolia", label: "Sepolia", hint: "The public test network, through MetaMask" },
];

export const HOSTED_PREVIEW = import.meta.env.MODE === "artifact";

export function NetworkSwitch() {
  const s = useSession();
  const navigate = useNavigate();
  // The hosted preview cannot reach Sepolia or a wallet extension; it offers the simulation only.
  if (HOSTED_PREVIEW) return null;
  return (
    <div className="segmented" role="group" aria-label="Network">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          aria-pressed={s.mode === o.mode}
          className="segmented__option"
          title={o.hint}
          onClick={() => {
            if (s.mode !== o.mode) {
              s.setMode(o.mode);
              navigate({ to: "/" });
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
