export type OddsFormat = 'decimal' | 'fractional' | 'american';

export function toDecimalString(price: number): string {
  return price.toFixed(2);
}

/** Nearest common fraction, the way a UK board would print it. */
export function toFractional(price: number): string {
  const target = price - 1;
  let best = { n: 1, d: 1, err: Infinity };
  for (let d = 1; d <= 100; d++) {
    const n = Math.round(target * d);
    if (n < 1) continue;
    const err = Math.abs(n / d - target);
    if (err < best.err - 1e-12) best = { n, d, err };
    if (err < 1e-9) break;
  }
  const g = gcd(best.n, best.d);
  return `${best.n / g}/${best.d / g}`;
}

export function toAmerican(price: number): string {
  if (price >= 2) return `+${Math.round((price - 1) * 100)}`;
  return `${Math.round(-100 / (price - 1))}`;
}

export function formatOdds(price: number | null | undefined, f: OddsFormat): string {
  if (price == null || !isFinite(price) || price <= 1) return '—';
  if (f === 'fractional') return toFractional(price);
  if (f === 'american') return toAmerican(price);
  return toDecimalString(price);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || !isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

/** Signed percentage with a real minus sign, for edges. */
export function signedPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !isFinite(x)) return '—';
  const v = x * 100;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}%` : s.replace('-', '−') + '%';
}

export function num(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return isFinite(n) ? n : null;
}

const DTF = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
});

export function kickoff(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${DTF.format(dt)} UTC`;
}

const DAYF = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export function day(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return DAYF.format(dt);
}

export function isoDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** "3 hours ago" / "in 2 days" — used for the as-of stamps. */
export function since(d: Date | string, now = new Date()): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const mins = Math.round((now.getTime() - dt.getTime()) / 60000);
  const abs = Math.abs(mins);
  const unit =
    abs < 60 ? [abs, 'minute'] :
    abs < 1440 ? [Math.round(abs / 60), 'hour'] :
    [Math.round(abs / 1440), 'day'];
  const n = unit[0] as number;
  const label = `${n} ${unit[1]}${n === 1 ? '' : 's'}`;
  return mins >= 0 ? `${label} ago` : `in ${label}`;
}

/**
 * Titles are the one piece of metadata a crawl audit can check mechanically, so
 * keep them inside the pixel budget rather than letting a long club name push a
 * title to 74 characters and get it rewritten.
 */
export function fit(preferred: string, fallback: string, max = 60): string {
  if (preferred.length <= max) return preferred;
  if (fallback.length <= max) return fallback;
  return fallback.slice(0, max - 1).replace(/[\s—–-]+$/, '') + '…';
}

/** Descriptions over ~160 characters get truncated by search engines. */
export function clamp(text: string, max = 158): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, stop > 60 ? stop : max).replace(/[\s,;:]+$/, '') + '.';
}
