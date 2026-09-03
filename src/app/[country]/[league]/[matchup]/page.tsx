import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { leagueFromPath, teamIndex } from '@/lib/resolve';
import { RETIRED_LEAGUES } from '@/lib/leagues';
import { splitMatchup } from '@/lib/slug';
import { tierFor, robotsFor, revalidateFor, type Tier } from '@/lib/tier';
import {
  findPairFixtures, asFindPairFixtures, asFindMeetings, asTeamFormAny,
  pricesFor, bookPrices, fixtureMargins, fixtureValue, type ValueRow,
  type PriceRow, type FixtureRow, type AsFixtureRow,
} from '@/lib/queries';
import { Breadcrumb } from '@/components/Chrome';
import { Card, Empty, Withheld, BestPriceCell, ModelCell, MarginBar, bookName, explain } from '@/components/Modules';
import { OddsFormatSwitcher, Price } from '@/components/Price';
// `Tier` is already the T1-T4 corpus type from @/lib/tier, so the badge
// component is aliased rather than shadowing a concept that means
// something else entirely.
import { Ladder, BestWorst, Tier as TierBadge, signed,
         selectionLabel, marketLabel } from '@/components/Board';
import { num, pct, signedPct, kickoff, day, formatOdds, fit, clamp } from '@/lib/fmt';

export const revalidate = 900;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

type Params = { country: string; league: string; matchup: string };

/* ------------------------------------------------------------------ */

async function load(p: Params) {
  const league = leagueFromPath(p.country, p.league);
  if (!league) return { gone: true as const, retired: RETIRED_LEAGUES.has(`${p.country}/${p.league}`) };

  const pair = splitMatchup(p.matchup);
  if (!pair) return { gone: true as const, retired: false };

  const idx = await teamIndex(league.competitionId);
  const homeNames = idx.aliases.get(pair.home);
  const awayNames = idx.aliases.get(pair.away);
  if (!homeNames || !awayNames) return { gone: true as const, retired: false };

  const homeLabel = idx.bySlug.get(pair.home)!;
  const awayLabel = idx.bySlug.get(pair.away)!;

  const [oddsFx, asFx] = await Promise.all([
    findPairFixtures(league.competitionId, homeNames, awayNames),
    asFindPairFixtures(league.competitionId, homeNames, awayNames),
  ]);

  const now = Date.now();
  // Annotated, not inferred: without the annotation TypeScript drops the
  // `?? null` (an array index is non-nullable without noUncheckedIndexedAccess)
  // and then treats the "no fixture scheduled" branch as unreachable.
  const upcoming: FixtureRow | null =
    oddsFx
      .filter((f) => new Date(f.commence_time).getTime() > now - 3 * 3600_000 && !f.completed)
      .sort((a, b) => +new Date(a.commence_time) - +new Date(b.commence_time))[0] ?? null;

  const playedDates = [
    ...oddsFx.filter((f) => f.completed).map((f) => new Date(f.commence_time)),
    ...asFx.filter((f) => f.completed).map((f) => new Date(f.commence_time)),
  ].sort((a, b) => +b - +a);
  const lastPlayed: Date | null = playedDates[0] ?? null;

  const lastResult: FixtureRow | AsFixtureRow | null =
    oddsFx.find((f) => f.completed) ?? asFx.find((f) => f.completed) ?? null;

  const prices: PriceRow[] = upcoming ? await pricesFor(upcoming.event_id) : [];
  const priced = prices.length > 0;

  const tier: Tier = tierFor({
    nextKickoff: upcoming ? new Date(upcoming.commence_time) : null,
    lastPlayed,
    priced,
  });
  if (tier === 4) return { gone: true as const, retired: false };

  const [books, margins, meetings, homeForm, awayForm] = await Promise.all([
    upcoming ? bookPrices(upcoming.event_id, 'h2h') : Promise.resolve([]),
    upcoming ? fixtureMargins(upcoming.event_id, 'h2h') : Promise.resolve([]),
    asFindMeetings(league.competitionId, homeNames, awayNames, 8),
    asTeamFormAny(league.competitionId, homeNames, 6),
    asTeamFormAny(league.competitionId, awayNames, 6),
  ]);

  return {
    gone: false as const, league, homeLabel, awayLabel, upcoming, lastResult,
    prices, books, margins, meetings, homeForm, awayForm, tier, homeNames, awayNames,
  };
}

/* --------------------------- metadata ----------------------------- */

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const d = await load(p);
  if (d.gone) return { title: 'Not found', robots: { index: false, follow: false } };

  const year = new Date().getFullYear();
  const H = d.homeLabel;
  const A = d.awayLabel;
  // Long club names blow the 60-character budget, so degrade the wording rather
  // than let the title get rewritten: "vs" -> "v", then drop "Prediction &".
  const title = fit(
    `${H} vs ${A} Prediction & Odds ${year}`,
    fit(`${H} v ${A} Odds & Prediction ${year}`, `${H} v ${A} Odds ${year}`),
  );

  const h2h = d.prices.filter((r) => r.market === 'h2h' && r.publishable);
  const home = h2h.find((r) => r.selection === 'home');
  const best = h2h.slice().sort((a, b) => (num(b.edge) ?? -9) - (num(a.edge) ?? -9))[0];
  const bits: string[] = [];

  // Read everything the description might need before branching. TypeScript
  // narrows `d` through an aliased check, and on the else branch it would
  // otherwise decide the loaded shape is unreachable.
  const up = d.upcoming;
  const last = d.lastResult;
  const meetingCount = d.meetings.length;

  if (up) {
    if (home?.model_prob) bits.push(`Our model makes ${H} ${pct(num(home.model_prob))} to win.`);
    if (best?.best_price && best.best_book) {
      bits.push(`Best price ${formatOdds(num(best.best_price), 'decimal')} at ${bookName(best.best_book)}.`);
    }
    if (!bits.length) bits.push(`${H} v ${A} priced by every bookmaker in our feed, with each book's margin measured.`);
    bits.push(day(up.commence_time) + '.');
  } else {
    // No fixture scheduled. A page with nothing specific to say would otherwise
    // share one description with every other unscheduled pairing — which is
    // exactly what gets a page crawled and then not indexed.
    if (last && last.home_score != null) {
      bits.push(
        `${last.home_team} ${last.home_score}–${last.away_score} ${last.away_team}, ` +
          `${day(last.commence_time)}.`,
      );
    }
    if (meetingCount) {
      bits.push(`${meetingCount} meetings on record.`);
    }
    bits.push(`Odds and our model's numbers return here when ${H} and ${A} are next drawn together.`);
  }
  const description = clamp(bits.join(' '));

  const canonical = `/${p.country}/${p.league}/${p.matchup}/`;
  return {
    title,
    description,
    robots: robotsFor(d.tier),
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'article' },
  };
}

/* ----------------------------- page ------------------------------- */

export default async function MatchupPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const d = await load(p);
  if (d.gone) notFound();

  const {
    league, homeLabel, awayLabel, upcoming, lastResult, prices, books, margins,
    meetings, homeForm, awayForm, tier,
  } = d;

  const h2h = prices.filter((r) => r.market === 'h2h');
  const sel = (s: string) => h2h.find((r) => r.selection === s) ?? null;
  const rows = [
    { key: 'home', label: homeLabel, row: sel('home') },
    { key: 'draw', label: 'Draw', row: sel('draw') },
    { key: 'away', label: awayLabel, row: sel('away') },
  ];

  const totals = prices.filter((r) => r.market.startsWith('totals'));
  const overround = bookOverround(books);
  const bestOverround = bestPriceOverround(rows.map((r) => num(r.row?.best_price)));

  const kickoffText = upcoming ? kickoff(upcoming.commence_time) : null;
  const fx = upcoming ?? lastResult ?? null;

  // THE BOARD. Every bookmaker on every outcome, and what each one is paying
  // you against what that outcome is worth. Grouped one outcome at a time,
  // because a reader wants a bet, not a thousand rows.
  const value = fx ? await fixtureValue(fx.event_id) : [];
  const groups = new Map<string, ValueRow[]>();
  for (const v of value) {
    const k = `${v.market_key}|${v.point ?? ''}|${v.selection}`;
    const list = groups.get(k);
    if (list) list.push(v); else groups.set(k, [v]);
  }
  const ORDER: Record<string, number> = { h2h: 0, totals: 1, spreads: 2 };
  const outcomes = [...groups.entries()]
    .map(([key, rs]) => ({
      key,
      market: rs[0].market_key,
      point: rs[0].point,
      selection: rs[0].selection,
      source: rs[0].ref_source,
      worth: num(rs[0].ref_prob) ?? 0,
      best: num(rs[0].overpay) ?? 0,
      rows: rs,
    }))
    .sort((a, b) =>
      (ORDER[a.market] ?? 9) - (ORDER[b.market] ?? 9) ||
      Number(a.point ?? 0) - Number(b.point ?? 0) ||
      b.best - a.best);

  // The call is the best-paying outcome our own model stands behind. Where the
  // model was gated -- it strayed too far from fifty bookmakers to be trusted
  // -- there is no call, and the page says so rather than reaching for the
  // consensus tier and quietly passing it off as the same claim.
  const call = outcomes.filter((o) => o.source === 'model' && o.best > 0)
                       .sort((a, b) => b.best - a.best)[0] ?? null;
  const gated = h2h.some((r) => r.withheld_reason === 'edge_implausible');

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb
        trail={[
          { href: '/', label: 'Football' },
          { href: `/${league.country}/`, label: league.countryName },
          { href: `/${league.country}/${league.league}/`, label: league.leagueName },
          { label: `${homeLabel} v ${awayLabel}` },
        ]}
      />

      <header className="match-head">
        <div>
          <h1>
            {homeLabel} <span className="vs">v</span> {awayLabel}
          </h1>
          <div className="meta">
            <span>{league.leagueName}</span>
            {kickoffText && <><i className="dot" /><span className="num">{kickoffText}</span></>}
            <i className="dot" />
            <span><span className="num">{value.length ? outcomes[0].rows[0].n_books : 0}</span> bookmakers compared</span>
          </div>
        </div>
        <OddsFormatSwitcher />
      </header>

      {call ? (
        <Card title="THE ENGINE'S CALL" sub="The one outcome our model says is underpriced">
          <div className="call">
            <div className="call-pick">
              <div className="kicker">BACK THIS</div>
              <div className="call-name">
                {selectionLabel(call.selection, homeLabel, awayLabel, call.point)}
              </div>
              <div className="call-price">
                <span className="num"><Price value={num(call.rows[0].price) ?? 0} /></span>
                <span className="call-at">best price at {bookName(call.rows[0].bookmaker_key)}</span>
              </div>
              <p className="call-say">
                We make this{' '}
                <strong className="num">{(call.worth * 100).toFixed(1)}%</strong> to happen, so a
                fair price would be <strong className="num">{(1 / call.worth).toFixed(2)}</strong>.{' '}
                {bookName(call.rows[0].bookmaker_key)} is offering{' '}
                <strong className="num"><Price value={num(call.rows[0].price) ?? 0} /></strong> — paying you{' '}
                <strong className="pay-up num">{signed(call.best)}</strong> more than the bet is
                worth. Every other book on this outcome is listed below, including the one paying
                you least.
              </p>
            </div>
            <div className="call-nums">
              <div>
                <div className="kicker">WHAT IT IS WORTH</div>
                <div className="big num">{(call.worth * 100).toFixed(1)}<span>%</span></div>
                <div className="cap">Our model&rsquo;s chance of it happening</div>
              </div>
              <div>
                <div className="kicker">FAIR PRICE</div>
                <div className="big num">{(1 / call.worth).toFixed(2)}</div>
                <div className="cap">What you should be paid, with no margin</div>
              </div>
              <div>
                <div className="kicker">BEST BOOK PAYS</div>
                <div className="big num pay-up">{signed(call.best)}</div>
                <div className="cap">More than fair, per unit staked</div>
              </div>
              <div>
                <div className="kicker">WORST BOOK PAYS</div>
                <div className="big num pay-down">
                  {signed(num(call.rows[call.rows.length - 1].overpay) ?? 0)}
                </div>
                <div className="cap">
                  Less than fair, at {bookName(call.rows[call.rows.length - 1].bookmaker_key)}
                </div>
              </div>
            </div>
          </div>
          <p className="note">
            Priced against our own model, which beats a league base rate out of sample on this
            market. We publish it unblended, and we refuse to publish it at all when it strays
            more than 15% from what fifty bookmakers think &mdash; a disagreement that large is
            far likelier to be our error than theirs.
          </p>
        </Card>
      ) : (
        <Card title="THE ENGINE'S CALL" sub="No recommendation on this match">
          <Withheld
            what={gated ? 'Our model disagreed with the market too sharply to trust'
                        : 'No outcome here is underpriced by our model'}
            reason={gated ? 'edge_implausible' : null}
          />
          <p className="note">
            The bookmaker comparison below still stands: it needs no forecast to be true, only
            the prices themselves.
          </p>
        </Card>
      )}

      <Card
        title="EVERY OUTCOME, EVERY BOOKMAKER"
        sub={outcomes.length ? `${outcomes.length} outcomes priced across ${new Set(value.map((v) => v.bookmaker_key)).size} books` : undefined}
      >
        {outcomes.length ? (
          outcomes.map((o) => (
            <section className="outcome" key={o.key}>
              <div className="outcome-head">
                <h3>
                  {selectionLabel(o.selection, homeLabel, awayLabel, o.point)}
                  <span className="mkt">{marketLabel(o.market, o.point)}</span>
                </h3>
                <TierBadge source={o.source} />
              </div>
              <BestWorst rows={o.rows} worth={o.worth} />
              <Ladder rows={o.rows} home={homeLabel} away={awayLabel} limit={6} />
            </section>
          ))
        ) : (
          <Empty head="No prices recorded" body="No bookmaker in our feed is currently pricing this match." />
        )}
        <p className="note">
          &ldquo;Their cut&rdquo; is how much of your stake that bookmaker keeps on that outcome,
          recovered from its own prices. It is not the same on every outcome: books take more for
          backing an outsider than a favourite, and how much more differs enormously between them.
        </p>
      </Card>

      {meetings.length > 0 && (
        <Card title="Head to head" sub={`Last ${meetings.length} meetings`}>
          <div className="scroller">
            <table className="data">
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.as_fixture_id}>
                    <td className="num m">{day(m.commence_time)}</td>
                    <td className="wrap">{m.home_team} v {m.away_team}</td>
                    <td className="right num">
                      {m.home_score ?? '—'}&ndash;{m.away_score ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(homeForm.length > 0 || awayForm.length > 0) && (
        <Card title="Recent form">
          <FormLine label={homeLabel} names={[homeLabel]} rows={homeForm} />
          <FormLine label={awayLabel} names={[awayLabel]} rows={awayForm} />
        </Card>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(homeLabel, awayLabel, league.leagueName, fx) }}
      />
    </div>
  );
}

function FormLine({ label, names, rows }: { label: string; names: string[]; rows: AsFixtureRow[] }) {
  const isUs = (n: string) => names.includes(n);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {rows.map((r) => {
          const us = isUs(r.home_team) ? 'home' : 'away';
          const gf = us === 'home' ? r.home_score : r.away_score;
          const ga = us === 'home' ? r.away_score : r.home_score;
          const res = gf == null || ga == null ? '·' : gf > ga ? 'W' : gf === ga ? 'D' : 'L';
          const bg = res === 'W' ? 'var(--good-bg)' : res === 'L' ? 'var(--bad-bg)' : 'var(--line-soft)';
          const fg = res === 'W' ? 'var(--good-fg)' : res === 'L' ? 'var(--bad-fg)' : '#475569';
          return (
            <span
              key={r.as_fixture_id}
              title={`${r.home_team} ${r.home_score ?? '–'}–${r.away_score ?? '–'} ${r.away_team}`}
              className="m"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 4, background: bg, color: fg,
                fontSize: 12, fontWeight: 600,
              }}
            >
              {res}
            </span>
          );
        })}
      </div>
    </div>
  );
}

type Grouped = { book: string; home: number | null; draw: number | null; away: number | null };

/**
 * The feed names an outcome by the team, not by "home"/"away", and rows arrive
 * in whatever order the index gives. Match on the team name; never on position,
 * which silently swapped the two columns the first time this was written.
 */
function groupBooks(
  books: { bookmaker_key: string; outcome_name: string; price: string }[],
  home: string,
  away: string,
) {
  const norm = (s: string) => s.trim().toLowerCase();
  const H = norm(home);
  const A = norm(away);
  const m = new Map<string, Grouped>();
  for (const b of books) {
    const g = m.get(b.bookmaker_key) ?? { book: b.bookmaker_key, home: null, draw: null, away: null };
    const p = num(b.price);
    const o = norm(b.outcome_name);
    if (o === 'draw') g.draw = p;
    else if (o === H) g.home = p;
    else if (o === A) g.away = p;
    else if (g.home === null) g.home = p;
    else g.away = p;
    m.set(b.bookmaker_key, g);
  }
  return { rows: [...m.values()], count: m.size };
}

/** Mean overround across books that priced all three outcomes. */
function bookOverround(books: { bookmaker_key: string; outcome_name: string; price: string }[]) {
  const byBook = new Map<string, number[]>();
  for (const b of books) {
    const p = num(b.price);
    if (!p || p <= 1) continue;
    const arr = byBook.get(b.bookmaker_key) ?? [];
    arr.push(1 / p);
    byBook.set(b.bookmaker_key, arr);
  }
  const sums = [...byBook.values()].filter((a) => a.length === 3).map((a) => a.reduce((x, y) => x + y, 0));
  if (!sums.length) return null;
  return sums.reduce((x, y) => x + y, 0) / sums.length;
}

function bestPriceOverround(prices: (number | null)[]) {
  if (prices.some((p) => !p || p <= 1)) return null;
  let sum = 0;
  for (const p of prices) sum += 1 / (p as number);
  return sum;
}

function jsonLd(home: string, away: string, league: string, fx: FixtureRow | null) {
  if (!fx) return { '@context': 'https://schema.org', '@type': 'WebPage', name: `${home} vs ${away}` };
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${home} vs ${away}`,
    startDate: new Date(fx.commence_time).toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    sport: 'Soccer',
    superEvent: { '@type': 'SportsOrganization', name: league },
    competitor: [
      { '@type': 'SportsTeam', name: home },
      { '@type': 'SportsTeam', name: away },
    ],
  };
}

/**
 * How to label a row that is not a plain sportsbook. The distinction is not
 * cosmetic: a 2% margin at an exchange and a 2% margin at a bookmaker are not
 * the same claim, because the exchange takes its cut from the winnings instead.
 */
function _removed_opTag(o: { model: string; commission_rate: string | null }): string {
  if (o.model !== 'exchange') return o.model.replace(/_/g, ' ');
  const cr = num(o.commission_rate);
  return cr == null
    ? 'exchange, commission not published'
    : `exchange, ${pct(cr, 0)} commission`;
}
