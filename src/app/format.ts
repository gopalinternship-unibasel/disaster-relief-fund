import { formatEther, type Address } from "viem";
import { demoAccountFor } from "../chain/accounts";

/**
 * ETH for people, without a unit: the exact decimal when it has at most `maxDecimals` places,
 * otherwise cut (not rounded) to that many places after a "≈". Amounts under 0.000001 ETH come
 * back as "<n> wei", so use ethAmount() wherever a unit follows.
 */
export function eth(wei: bigint, maxDecimals = 6): string {
  if (wei === 0n) return "0";
  const abs = wei < 0n ? -wei : wei;
  const sign = wei < 0n ? "−" : "";
  if (abs < 1_000_000_000_000n) return `${sign}${abs.toString()} wei`;
  const exact = formatEther(abs);
  const [whole, frac = ""] = exact.split(".");
  if (frac.length <= maxDecimals) return sign + exact;
  return `≈${sign}${whole}.${frac.slice(0, maxDecimals)}`;
}

/** An amount with its unit: "0.004 ETH", "≈0.003333 ETH", or "101 wei" for tiny amounts. */
export function ethAmount(wei: bigint, maxDecimals = 6): string {
  const text = eth(wei, maxDecimals);
  return text.endsWith(" wei") ? text : `${text} ETH`;
}

/** Like eth(), but with a fixed number of decimals for aligned columns. */
export function ethFixed(wei: bigint, decimals = 4): string {
  const abs = wei < 0n ? -wei : wei;
  const sign = wei < 0n ? "−" : "";
  const [whole, frac = ""] = formatEther(abs).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return `${sign}${whole}.${padded}`;
}

/** Decimals that show every value in a column exactly: at least `min`, at most `max`. */
export function decimalsFor(values: bigint[], min = 4, max = 6): number {
  let need = min;
  for (const v of values) {
    const frac = formatEther(v < 0n ? -v : v).split(".")[1] ?? "";
    need = Math.max(need, frac.length);
  }
  return Math.min(need, max);
}

/** Wei written as Remix and the guide write it: plain digits, no separators. */
export function weiText(wei: bigint) {
  return `${wei.toString()} wei`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** "Account 2" for a simulation account, otherwise the short address. */
export function accountName(address: Address | string, you?: string | null): string {
  if (you && address.toLowerCase() === you.toLowerCase()) return "You";
  const demo = demoAccountFor(address);
  return demo ? `Account ${demo.index}` : shortAddress(address);
}

export function plural(n: number | bigint, one: string, many = `${one}s`) {
  return `${n.toString()} ${Number(n) === 1 ? one : many}`;
}

/** "4 min 12 s", "2 h 5 min", "3 days". */
export function duration(seconds: bigint): string {
  let s = Number(seconds < 0n ? -seconds : seconds);
  if (s < 60) return `${s} s`;
  const days = Math.floor(s / 86_400);
  s -= days * 86_400;
  const hours = Math.floor(s / 3_600);
  s -= hours * 3_600;
  const minutes = Math.floor(s / 60);
  const secs = s - minutes * 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : plural(days, "day");
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return secs > 0 && minutes < 10 ? `${minutes} min ${secs} s` : `${minutes} min`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** A block time in the viewer's time zone; the date is added when it is not today. */
export function clockTime(timestamp: bigint): string {
  const d = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(d.getTime())) return `timestamp ${timestamp} (beyond what a calendar shows)`;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? timeFmt.format(d) : dateTimeFmt.format(d);
}

export const ETHERSCAN = "https://sepolia.etherscan.io";

/**
 * Copies text from inside a click handler. Falls back to a hidden text area and the browser's copy
 * command where the clipboard API is refused (some embedded frames, older browsers).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
