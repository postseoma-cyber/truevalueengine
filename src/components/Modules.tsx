import Link from 'next/link';
import { num, pct, signedPct, formatOdds } from '@/lib/fmt';
import { Price } from './Price';

export function Card({
  title, sub, children, lead = false, foot,
}: {
  title: string; sub?: string; children: React.ReactNode; lead?: boolean; foot?: React.ReactNode;
}) {
  return (
    <section className={lead ? 'card card--lead' : 'card'}>
      <div className="cardHead">
        <h2 className="eyebrow">{title}</h2>
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
      {children}
      {foot ? <div className="note"><span className="dot" />{foot}</div> : null}
    </section>
  );
}

export function Empty({ head, body }: { head: string; body: string }) {
  return (
    <div style={{ padding: 20 }}>
      <div className="empty">
        <b>{head}</b>
        <span>{body}</span>
      </div>
    </div>
  );
}

/**
 * A market or a number we are deliberately not publishing. The reason is shown,
 * never hidden: silently omitting a figure is how a site ends up looking like it
 * only reports its wins.
 */
export function Withheld({ reason, what }: { reason: string | null; what: string }) {
  return (
    <div style={{ padding: 20 }}>
      <div className="empty" style={{ borderColor: 'var(--rule)' }}>
        <b>{what} is withheld</b>
        <span>{explain(reason)}</span>
      </div>
    </div>
  );
}

export function explain(reason: string | null): string {
  switch (reason) {
    case 'thin_league_history':
      return 'This competition has too few matches on record for the model to rate it. Publishing a number here would be inventing one.';
    case 'market_not_validated':
      return 'This market did not beat a naive baseline in out-of-sample testing, so the model has no edge to report on it.';
    case 'no_price':
      return 'No bookmaker in our feed is currently pricing this selection.';
    default:
      return reason
        ? `Withheld: ${reason.replace(/_/g, ' ')}.`
        : 'The engine did not produce a publishable number for this selection.';
  }
}

/** Best price against the margin-free consensus — the market read. */
export function BestPriceCell({
  label, price, book, fairPrice, marketEdge,
}: {
  label: string; price: number | null; book: string | null;
  fairPrice: number | null; marketEdge: number | null;
}) {
  const tone = marketEdge == null ? '' : marketEdge > 0.002 ? ' tag--good' : marketEdge < -0.002 ? ' tag--bad' : '';
  return (
    <div style={{ background: 'var(--card)', padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 14 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="m" style={{ fontSize: 34, fontWeight: 600, color: 'var(--ink)' }}>
          <Price value={price} />
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{book ? bookName(book) : '—'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--muted)' }}>
          fair <span className="m">{formatOdds(fairPrice, 'decimal')}</span>
        </span>
        <span className={`tag${tone} m`}>{signedPct(marketEdge)}</span>
      </div>
    </div>
  );
}

export function ModelCell({
  label, modelProb, marketProb, edge, publishable, reason,
}: {
  label: string; modelProb: number | null; marketProb: number | null;
  edge: number | null; publishable: boolean; reason: string | null;
}) {
  return (
    <div style={{ background: 'var(--card)', padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 14 }}>{label}</div>
      {publishable && modelProb != null ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="m" style={{ fontSize: 28, fontWeight: 600, color: 'var(--ink)' }}>{pct(modelProb)}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              model · fair <span className="m">{formatOdds(modelProb ? 1 / modelProb : null, 'decimal')}</span>
            </span>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            market <span className="m">{pct(marketProb)}</span>
            {edge != null ? (
              <>
                {' · '}edge <span className="m">{signedPct(edge)}</span>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{explain(reason)}</div>
      )}
    </div>
  );
}

/** Bookmaker keys come from the odds feed; make them presentable. */
export function bookName(key: string): string {
  const special: Record<string, string> = {
    onexbet: '1xBet', betfair_ex_uk: 'Betfair Exchange', betfair_ex_eu: 'Betfair Exchange (EU)',
    betfair_ex_au: 'Betfair Exchange (AU)', betfair_sb_uk: 'Betfair Sportsbook',
    williamhill: 'William Hill', skybet: 'Sky Bet', paddypower: 'Paddy Power',
    betmgm: 'BetMGM', pointsbetus: 'PointsBet', draftkings: 'DraftKings',
    betvictor: 'BetVictor', betonlineag: 'BetOnline', lowvig: 'LowVig',
    mybookieag: 'MyBookie', betus: 'BetUS', unibet_uk: 'Unibet', unibet_eu: 'Unibet (EU)',
    matchbook: 'Matchbook', smarkets: 'Smarkets', nordicbet: 'NordicBet',
    everygame: 'Everygame', gtbets: 'GTbets', fanduel: 'FanDuel', espnbet: 'ESPN Bet',
  };
  if (special[key]) return special[key];
  return key
    .replace(/_(uk|eu|au|us|us2|ca)$/i, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function MarginBar({ label, margin, worst }: { label: string; margin: number; worst: number }) {
  // A measured margin can come out slightly negative when two books disagree
  // enough that the best prices cross. Clamp the bar rather than drawing a
  // negative width, but still print the real figure.
  const w = worst > 0 ? Math.min(100, Math.max(4, Math.round((Math.max(margin, 0) / worst) * 100))) : 4;
  const lowest = margin <= worst * 0.35;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(96px,132px) 1fr 56px', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--line-soft)' }}>
        <div style={{ width: `${w}%`, height: 8, borderRadius: 4, background: lowest ? 'var(--accent)' : 'var(--rule)' }} />
      </div>
      <span className="m" style={{ fontSize: 12, textAlign: 'right', color: 'var(--body)' }}>{pct(margin, 2)}</span>
    </div>
  );
}

export function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
