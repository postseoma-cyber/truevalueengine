import { Price } from '@/components/Price';
import { bookName } from '@/components/Modules';
import type { ValueRow } from '@/lib/queries';

/* The over/underpay board. The site's one claim, rendered.
 *
 * For a given outcome we know what it is worth, so every bookmaker's price is
 * either more than that or less than it, and by how much. Both directions are
 * shown: the overpay is the bet, the underpay is the reason to stop using that
 * book. Naming the worst payer is the sharpest thing on the page and it is not
 * softened for anyone we might later take money from. */

export const num = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** "+6.9%" / "−8.1%" — a real minus sign, and never a bare "0%". */
export function signed(x: number, dp = 1): string {
  const v = x * 100;
  if (Math.abs(v) < 0.05) return '0.0%';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(dp) + '%';
}

export function Overpay({ v, big }: { v: number; big?: boolean }) {
  const cls = v > 0.0005 ? 'pay-up' : v < -0.0005 ? 'pay-down' : 'pay-flat';
  return <span className={`num ${cls}${big ? ' pay-big' : ''}`}>{signed(v)}</span>;
}

/** Which claim this row is making. The two are not interchangeable. */
export function Tier({ source }: { source: 'model' | 'consensus' }) {
  return source === 'model' ? (
    <span className="tier tier-model" title="Priced against our own model, which is validated out of sample on this market">
      our model
    </span>
  ) : (
    <span className="tier tier-cons" title="Priced against the margin-free consensus of the bookmakers quoting this market">
      market consensus
    </span>
  );
}

export function selectionLabel(sel: string, home: string, away: string, point: string | null) {
  switch (sel) {
    case 'home': return home;
    case 'away': return away;
    case 'draw': return 'Draw';
    case 'over': return `Over ${point ?? ''}`.trim();
    case 'under': return `Under ${point ?? ''}`.trim();
    default: return sel;
  }
}

export function marketLabel(market: string, point: string | null) {
  if (market === 'h2h') return 'Match result';
  if (market === 'totals') return `Total goals ${point ?? ''}`.trim();
  if (market === 'spreads') return `Handicap ${point ?? ''}`.trim();
  return market;
}

/**
 * One outcome, every book, best payer first. `hold` is that book's own cut on
 * this leg, recovered from its own prices by Shin's method -- so the reader can
 * see not just that a book pays badly but that it is taking more from them here
 * than elsewhere on the same match.
 */
export function Ladder({
  rows, home, away, limit,
}: { rows: ValueRow[]; home: string; away: string; limit?: number }) {
  if (!rows.length) return null;
  const shown = limit ? rows.slice(0, limit) : rows;
  const worst = rows[rows.length - 1];
  return (
    <div className="scroller">
      <table className="data board">
        <thead>
          <tr>
            <th className="rank"></th>
            <th className="wrap">Bookmaker</th>
            <th className="right">Price</th>
            <th className="right">Pays you</th>
            <th className="right">Their cut</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b, i) => {
            const op = num(b.overpay) ?? 0;
            const h = num(b.hold);
            const isWorst = b.bookmaker_key === worst.bookmaker_key;
            return (
              <tr key={b.bookmaker_key} className={i === 0 ? 'best' : isWorst ? 'worst' : undefined}>
                <td className="rank num">{i + 1}</td>
                <td className="wrap">
                  {bookName(b.bookmaker_key)}
                  {i === 0 && <span className="flag flag-best">BEST</span>}
                  {isWorst && i !== 0 && <span className="flag flag-worst">WORST</span>}
                </td>
                <td className="right"><Price value={num(b.price) ?? 0} /></td>
                <td className="right"><Overpay v={op} /></td>
                <td className="right m">{h === null ? '—' : (h * 100).toFixed(1) + '%'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {limit && rows.length > limit && (
        <p className="note">
          Showing {limit} of {rows.length} bookmakers, best payer first.
        </p>
      )}
    </div>
  );
}

/** The compact verdict: who pays over the odds here, and who is short-changing you. */
export function BestWorst({ rows, worth }: { rows: ValueRow[]; worth: number }) {
  if (rows.length < 2) return null;
  const best = rows[0], worst = rows[rows.length - 1];
  const bo = num(best.overpay) ?? 0, wo = num(worst.overpay) ?? 0;
  return (
    <div className="bestworst">
      <div className="bw-row">
        <span className="bw-key">Pays most</span>
        <span className="bw-book">{bookName(best.bookmaker_key)}</span>
        <span className="num bw-price"><Price value={num(best.price) ?? 0} /></span>
        <Overpay v={bo} big />
      </div>
      <div className="bw-row">
        <span className="bw-key">Pays least</span>
        <span className="bw-book">{bookName(worst.bookmaker_key)}</span>
        <span className="num bw-price"><Price value={num(worst.price) ?? 0} /></span>
        <Overpay v={wo} big />
      </div>
      <p className="note">
        Worth <span className="num">{(1 / worth).toFixed(2)}</span> at a true{' '}
        <span className="num">{(worth * 100).toFixed(1)}%</span>. The gap between those two
        books is <span className="num">{((bo - wo) * 100).toFixed(1)}</span> percentage points
        of your stake, on the same bet.
      </p>
    </div>
  );
}
