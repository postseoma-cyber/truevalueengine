import { Price } from '@/components/Price';
import { bookName } from '@/components/Modules';
import { num, signed, Overpay } from '@/components/Board';
import type { ValueRow } from '@/lib/queries';

/* The matchup page, the way the old site had it and the way it should have
 * stayed: one small table per market, read left to right.
 *
 *   Bet | True probability | Fair odds | Best odds | Edge | Market says
 *
 * Everything on the row is derived from the two numbers on the left, so a
 * reader can check us with a calculator. Under it, the runners-up: the next
 * few books on the same market, so the eye-catching best price is visible as
 * the best of a field rather than as a number with no context. */

export type Outcome = {
  selection: string;
  label: string;
  /** Every book on this leg, best price first. */
  rows: ValueRow[];
  /** Our model's chance, where the model prices this market. */
  modelProb: number | null;
  /** The margin-free consensus of the books quoting it. */
  marketProb: number;
  /** What we price against: the model where we have one, the market otherwise. */
  ref: number;
  usesModel: boolean;
  fair: number;
  best: ValueRow | null;
  edge: number | null;
};

export type Line = {
  key: string;
  market: string;
  point: string | null;
  title: string;
  outcomes: Outcome[];
  bookCount: number;
};

const SEL_ORDER: Record<string, number> = {
  home: 0, draw: 1, away: 2, over: 0, under: 1,
};

export function outcomeLabel(sel: string, home: string, away: string, point: string | null) {
  switch (sel) {
    case 'home': return home;
    case 'away': return away;
    case 'draw': return 'Draw';
    case 'over': return `Over ${plainPoint(point)}`;
    case 'under': return `Under ${plainPoint(point)}`;
    default: return sel;
  }
}

/** A total is a line, not a handicap: 2.5, never +2.5. */
export function plainPoint(p: string | null) {
  if (p === null || p === '') return '';
  const n = Number(p);
  return Number.isFinite(n) ? String(n) : p;
}

/** A handicap always carries its sign, because the sign is the whole meaning. */
export function trimPoint(p: string | null) {
  if (p === null || p === '') return '';
  const n = Number(p);
  if (!Number.isFinite(n)) return p;
  return (n > 0 ? '+' : '') + String(n);
}

export function lineTitle(market: string, point: string | null) {
  if (market === 'h2h') return 'Match result';
  if (market === 'totals') return `Total goals, ${plainPoint(point)} line`;
  if (market === 'spreads') return `Handicap ${trimPoint(point)}`;
  return market;
}

/** Groups one fixture's board into markets, and each market into its lines. */
export function buildLines(
  value: ValueRow[], home: string, away: string, perMarket = 2,
): Line[] {
  const byLine = new Map<string, Map<string, ValueRow[]>>();
  for (const v of value) {
    const lk = `${v.market_key}|${v.point ?? ''}`;
    let outs = byLine.get(lk);
    if (!outs) { outs = new Map(); byLine.set(lk, outs); }
    const list = outs.get(v.selection);
    if (list) list.push(v); else outs.set(v.selection, [v]);
  }

  const lines: Line[] = [];
  for (const [lk, outs] of byLine) {
    const [market, pointRaw] = lk.split('|');
    const point = pointRaw === '' ? null : pointRaw;
    const books = new Set<string>();
    const outcomes: Outcome[] = [];

    for (const [selection, raw] of outs) {
      const rows = raw.slice().sort((a, b) => (num(b.price) ?? 0) - (num(a.price) ?? 0));
      for (const r of rows) books.add(r.bookmaker_key);
      const modelProb = num(rows[0].model_prob);
      const marketProb = num(rows[0].ref_prob) ?? 0;
      const usesModel = modelProb !== null && modelProb > 0;
      const ref = usesModel ? (modelProb as number) : marketProb;
      const best = rows[0] ?? null;
      const bp = num(best?.price);
      outcomes.push({
        selection,
        label: outcomeLabel(selection, home, away, point),
        rows,
        modelProb,
        marketProb,
        ref,
        usesModel,
        fair: ref > 0 ? 1 / ref : 0,
        best,
        edge: bp && ref > 0 ? bp * ref - 1 : null,
      });
    }

    outcomes.sort((a, b) => (SEL_ORDER[a.selection] ?? 9) - (SEL_ORDER[b.selection] ?? 9));
    lines.push({
      key: lk, market, point,
      title: lineTitle(market, point),
      outcomes,
      bookCount: books.size,
    });
  }

  const MARKET_ORDER: Record<string, number> = { h2h: 0, totals: 1, spreads: 2 };
  // Within a market, the line every book quotes is the one the reader wants
  // first. Handicaps in particular run to a dozen thinly-quoted lines per
  // match, and a page with a dozen near-identical tables on it is exactly the
  // failure this rewrite is undoing -- so only the best-covered lines are kept.
  lines.sort((a, b) =>
    (MARKET_ORDER[a.market] ?? 9) - (MARKET_ORDER[b.market] ?? 9) ||
    b.bookCount - a.bookCount ||
    Number(a.point ?? 0) - Number(b.point ?? 0));

  const kept: Line[] = [];
  const seen = new Map<string, number>();
  for (const l of lines) {
    // A line no one is really pricing is noise, not coverage.
    if (l.bookCount < 3 || l.outcomes.length < 2) continue;
    const n = seen.get(l.market) ?? 0;
    if (n >= perMarket) continue;
    seen.set(l.market, n + 1);
    kept.push(l);
  }
  return kept;
}

/* ------------------------------ table A ------------------------------ */

export function ValueTable({ line }: { line: Line }) {
  const anyModel = line.outcomes.some((o) => o.usesModel);
  return (
    <div className="scroller">
      <table className="data value">
        <thead>
          <tr>
            <th className="wrap">Bet</th>
            <th className="right"><span className="wide-only">True </span>probability</th>
            <th className="right col-fair">Fair odds</th>
            <th className="right">Best odds</th>
            <th className="right">Edge</th>
            {anyModel && <th className="right col-market">Market says</th>}
          </tr>
        </thead>
        <tbody>
          {line.outcomes.map((o) => (
            <tr key={o.selection}>
              <td className="wrap bet">{o.label}</td>
              <td className="right m">{(o.ref * 100).toFixed(1)}%</td>
              <td className="right m col-fair">{o.fair ? o.fair.toFixed(2) : '—'}</td>
              <td className="right">
                {o.best ? (
                  <>
                    <span className="bestodds num"><Price value={num(o.best.price) ?? 0} /></span>
                    <span className="bestbook">{bookName(o.best.bookmaker_key)}</span>
                  </>
                ) : '—'}
              </td>
              <td className="right">{o.edge === null ? '—' : <Overpay v={o.edge} />}</td>
              {anyModel && (
                <td className="right m dim col-market">{(o.marketProb * 100).toFixed(1)}%</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ table B ------------------------------ */

/**
 * The runners-up. Books that quote the whole line, ranked by what they pay
 * across it, best price in each column marked. The book paying least on each
 * outcome is marked too -- it is the same information and readers deserve it.
 */
export function BookGrid({ line, limit = 6 }: { line: Line; limit?: number }) {
  const sels = line.outcomes.map((o) => o.selection);
  const byBook = new Map<string, Map<string, ValueRow>>();
  for (const o of line.outcomes) {
    for (const r of o.rows) {
      let m = byBook.get(r.bookmaker_key);
      if (!m) { m = new Map(); byBook.set(r.bookmaker_key, m); }
      m.set(o.selection, r);
    }
  }

  const full = [...byBook.entries()]
    .filter(([, m]) => sels.every((s) => m.has(s)))
    .map(([book, m]) => {
      let score = 0;
      for (const o of line.outcomes) {
        const p = num(m.get(o.selection)!.price) ?? 0;
        score += p * o.ref - 1;
      }
      return { book, cells: m, score: score / line.outcomes.length };
    })
    .sort((a, b) => b.score - a.score);

  if (full.length < 2) return null;
  const shown = full.slice(0, limit);

  const bestOf = new Map<string, number>();
  const worstOf = new Map<string, number>();
  for (const o of line.outcomes) {
    const ps = full.map((f) => num(f.cells.get(o.selection)!.price) ?? 0);
    bestOf.set(o.selection, Math.max(...ps));
    worstOf.set(o.selection, Math.min(...ps));
  }

  return (
    <div className="scroller">
      <table className="data grid">
        <thead>
          <tr>
            <th className="wrap">Bookmaker</th>
            {line.outcomes.map((o) => (
              <th key={o.selection} className="right wrap">{o.label}</th>
            ))}
            <th className="right">Average edge</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f, i) => (
            <tr key={f.book} className={i === 0 ? 'best' : undefined}>
              <td className="wrap book">
                {bookName(f.book)}
                {i === 0 && <span className="flag flag-best">BEST OVERALL</span>}
              </td>
              {line.outcomes.map((o) => {
                const p = num(f.cells.get(o.selection)!.price) ?? 0;
                const top = Math.abs(p - (bestOf.get(o.selection) ?? 0)) < 1e-9;
                const bot = Math.abs(p - (worstOf.get(o.selection) ?? 0)) < 1e-9;
                return (
                  <td key={o.selection}
                      className={`right num${top ? ' cell-best' : bot ? ' cell-worst' : ''}`}>
                    <Price value={p} />
                  </td>
                );
              })}
              <td className="right"><Overpay v={f.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {full.length > limit && (
        <p className="gridfoot">
          {shown.length} of {full.length} bookmakers pricing this line, best payer first.
        </p>
      )}
    </div>
  );
}

/** One sentence saying, in words, what the table above just said in numbers. */
export function LineSay({ line }: { line: Line }) {
  const withEdge = line.outcomes.filter((o) => o.edge !== null);
  if (!withEdge.length) return null;
  const top = withEdge.slice().sort((a, b) => (b.edge as number) - (a.edge as number))[0];
  const bottom = withEdge.slice().sort((a, b) => (a.edge as number) - (b.edge as number))[0];
  const worstRow = bottom.rows[bottom.rows.length - 1];
  const wp = num(worstRow?.price) ?? 0;
  const worstEdge = wp * bottom.ref - 1;
  return (
    <p className="linesay">
      We make <b>{top.label}</b> {(top.ref * 100).toFixed(1)}% to happen, so a fair price is{' '}
      <b className="num">{top.fair.toFixed(2)}</b>.{' '}
      {bookName(top.best!.bookmaker_key)} pays{' '}
      <b className="num"><Price value={num(top.best!.price) ?? 0} /></b> —{' '}
      <b className={(top.edge as number) >= 0 ? 'pay-up' : 'pay-down'}>{signed(top.edge as number)}</b>{' '}
      against what the bet is worth. At the other end,{' '}
      {bookName(worstRow.bookmaker_key)} pays{' '}
      <b className="num"><Price value={wp} /></b> on <b>{bottom.label}</b>, which is{' '}
      <b className={worstEdge >= 0 ? 'pay-up' : 'pay-down'}>{signed(worstEdge)}</b>.
    </p>
  );
}
