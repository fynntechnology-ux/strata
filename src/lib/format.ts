/**
 * Number formatting.
 *
 * Always with an explicit locale. Bare `toLocaleString()` uses the runtime's
 * default, which differs between the Node process that server-renders a page
 * and the browser that hydrates it — the result is a hydration mismatch that
 * only shows up on some machines, which is the worst kind of bug to chase.
 *
 * The game is English-only for now; when that changes, this is the one place
 * that has to learn about locales.
 */

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PRECISE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** 1234567 -> "1,234,567" */
export function num(value: number): string {
  return INTEGER.format(Math.round(value));
}

/** 12.34 -> "12.3" */
export function dec(value: number): string {
  return DECIMAL.format(value);
}

/** 12.345 -> "12.35", trailing zeros dropped. */
export function precise(value: number): string {
  return PRECISE.format(value);
}

/** 1234567 -> "1.2M". For dense readouts where full digits don't fit. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(value / 1_000)}K`;
  return num(value);
}

function trim(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** Signed percentage, e.g. "+14%" / "-9%". */
export function pct(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** "2m 14s" — for cooldowns and time-to-full readouts. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.floor(seconds % 60);
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** "just now" / "4m ago" / "3d ago" — relative to a client clock. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
