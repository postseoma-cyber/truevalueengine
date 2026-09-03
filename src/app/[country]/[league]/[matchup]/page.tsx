import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { leagueFromPath, teamIndex } from '@/lib/resolve';
import { RETIRED_LEAGUES } from '@/lib/leagues';
import { splitMatchup } from '@/lib/slug';
import { tierFor, robotsFor, revalidateFor, type Tier } from '@/lib/tier';
import {
  findPairFixtures, asFindPairFixtures, asFindMeetings, asTeamFormAny,
  pricesFor, bookPrices, fixtureMargins, operatorModels,
  type PriceRow, type FixtureRow, type AsFixtureRow,
} from '@/lib/queries';
import { Breadcrumb } from '@/components/Chrome';
import { Card, Empty, Withheld, BestPriceCell, ModelCell, MarginBar, bookName, explain } from '@/components/Modules';
import { OddsFormatSwitcher, Price } from '@/components/Price';
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

  // What kind of operator each row is. An exchange quote is gross of
  // commission and a bookmaker's is not, so without this the table appears to
  // contradict the best price above it: the engine nets exchange prices off
  // before picking a best, and a gross figure here can look better than the
  // net one we named. Saying which is which costs one small query.
  const opModels = new Map((await operatorModels()).map((o) => [o.bookmaker_key, o]));
  const bookRows = groupBooks(books, homeLabel, awayLabel);
  const marginByBook = new Map(margins.map((m) => [m.bookmaker_key, num(m.margin) ?? 0]));
  const worstMargin = margins.length ? num(margins[margins.length - 1].margin) ?? 0 : 0;

  const kickoffText = upcoming ? kickoff(upcoming.commence_time) : null;

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

      <header
        style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 24, padding: '14px 0 20px', flexWrap: 'wrap',
        }}
      >
        <div>
          <h1>{homeLabel} vs {awayLabel} odds</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--muted)', marginTop: 8, flexWrap: 'wrap' }}>
            {kickoffText ? <span>{kickoffText}</span> : <span>No fixture scheduled</span>}
            <span style={{ color: 'var(--rule)' }}>·</span>
            <span>{league.leagueName}</span>
            {bookRows.count ? (
              <>
                <span style={{ color: 'var(--rule)' }}>·</span>
                <span><span className="m">{bookRows.count}</span> bookmakers compared</span>
              </>
            ) : null}
          </div>
        </div>
        <OddsFormatSwitcher />
      </header>

      <div className="stack">
        {/* ---------------- the market read ---------------- */}
        <Card
          title="Best price, and what it is worth"
          sub="Fair price = every book's margin stripped, then averaged"
          lead
          foot={
            bestOverround && overround ? (
              <span>
                Taking the best price on each outcome, this match prices at{' '}
                <span className="m" style={{ fontWeight: 600, color: 'var(--ink)' }}>{pct(bestOverround, 1)}</span>{' '}
                — against a <span className="m">{pct(overround, 1)}</span> market average.
                Anything under 100% would be arbitrage; it rarely is.
              </span>
            ) : (
              <span>Not enough books are pricing this match to compute a market average.</span>
            )
          }
        >
          {upcoming ? (
            <div className="grid3">
              {rows.map((r) => {
                const price = num(r.row?.best_price);
                const mp = num(r.row?.market_prob);
                const fair = mp ? 1 / mp : null;
                const marketEdge = price && mp ? price * mp - 1 : null;
                return (
                  <BestPriceCell
                    key={r.key}
                    label={r.label}
                    price={price}
                    book={r.row?.best_book ?? null}
                    fairPrice={fair}
                    marketEdge={marketEdge}
                  />
                );
              })}
            </div>
          ) : (
            <Empty
              head="No fixture scheduled"
              body="This page shows prices when the two clubs are next drawn together. Below is the record of their meetings."
            />
          )}
        </Card>

        {/* ---------------- the model ---------------- */}
        <Card
          title="What our model makes it"
          sub="Poisson attack/defence, fitted on results — never on bookmaker prices"
          foot={
            <span>
              The model is published exactly as it computes, unblended. It is
              measurably over-confident on away sides — see{' '}
              <Link href="/model/accuracy/">how it scores</Link> before acting on an edge.
            </span>
          }
        >
          {upcoming && h2h.length ? (
            <div className="grid3">
              {rows.map((r) => (
                <ModelCell
                  key={r.key}
                  label={r.label}
                  modelProb={num(r.row?.model_prob)}
                  marketProb={num(r.row?.market_prob)}
                  edge={num(r.row?.edge)}
                  publishable={!!r.row?.publishable}
                  reason={r.row?.withheld_reason ?? 'no_price'}
                />
              ))}
            </div>
          ) : upcoming ? (
            <Withheld what="The model read" reason={null} />
          ) : (
            <Empty head="Nothing to price" body="The model rates scheduled fixtures only." />
          )}
        </Card>

        {/* ---------------- every book ---------------- */}
        <Card title="Match result — every book" sub={bookRows.count ? `${bookRows.count} books, lowest margin first` : undefined}>
          {bookRows.rows.length ? (
            <>
            <div className="scroller">
              <table className="data">
                <thead>
                  <tr>
                    <th className="wrap">Bookmaker</th>
                    <th className="right">{homeLabel}</th>
                    <th className="right">Draw</th>
                    <th className="right">{awayLabel}</th>
                    <th className="right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {bookRows.rows
                    .slice()
                    .sort((a, b) => (marginByBook.get(a.book) ?? 9) - (marginByBook.get(b.book) ?? 9))
                    .map((b) => (
                      <tr key={b.book}>
                        <td className="wrap">
                          {bookName(b.book)}
                          {opModels.has(b.book) && (
                            <span className="sub"> {opTag(opModels.get(b.book)!)}</span>
                          )}
                        </td>
                        <td className="right"><Price value={b.home} /></td>
                        <td className="right"><Price value={b.draw} /></td>
                        <td className="right"><Price value={b.away} /></td>
                        <td className="right m">
                          {marginByBook.has(b.book) ? pct(marginByBook.get(b.book)!, 2) : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {bookRows.rows.some((b) => opModels.has(b.book)) && (
              <p className="note">
                Exchange and prediction-market prices are listed exactly as the
                operator quotes them, gross of commission. The best price above is
                chosen after netting off each operator&rsquo;s published standard
                commission, so a gross figure here can read better than the price we
                name best. An exchange that publishes no standard rate still counts
                towards the consensus but can never win best price.
              </p>
            )}
            </>
          ) : (
            <Empty head="No prices recorded" body="No bookmaker in our feed is currently pricing this match." />
          )}
        </Card>

        {/* ---------------- rail ---------------- */}
        <div className="rail">
          <Card title="Price movement" sub="Every change we have recorded">
            <Empty
              head="Recording since 2 September 2026"
              body="A movement chart appears once a line has moved more than once. We do not draw a chart from a single observation."
            />
          </Card>

          <Card title="Cheapest books on this match" sub="Margin is what the book keeps. Lower is better for you.">
            {margins.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 24px 22px' }}>
                {margins.slice(0, 6).map((m) => (
                  <MarginBar key={m.bookmaker_key} label={bookName(m.bookmaker_key)} margin={num(m.margin) ?? 0} worst={worstMargin} />
                ))}
              </div>
            ) : (
              <Empty head="No margin measured yet" body="Margin needs a complete set of prices from a book on this match." />
            )}
          </Card>
        </div>

        {/* ---------------- other markets ---------------- */}
        <Card title="Over / under 2.5 goals" sub="Published only where the market passed out-of-sample testing">
          {totals.length ? (
            totals.some((t) => t.publishable) ? (
              <div className="grid3">
                {totals.map((t) => (
                  <ModelCell
                    key={t.selection}
                    label={t.selection === 'over' ? 'Over 2.5' : 'Under 2.5'}
                    modelProb={num(t.model_prob)}
                    marketProb={num(t.market_prob)}
                    edge={num(t.edge)}
                    publishable={t.publishable}
                    reason={t.withheld_reason}
                  />
                ))}
              </div>
            ) : (
              <Withheld what="Over/under" reason={totals[0].withheld_reason} />
            )
          ) : (
            <Empty head="Not priced" body="Goals markets are fetched close to kick-off to stay inside the credit budget." />
          )}
        </Card>

        {/* ---------------- history ---------------- */}
        <div className="rail">
          <Card title="Head to head" sub={meetings.length ? `Last ${meetings.length} meetings` : undefined}>
            {meetings.length ? (
              <div className="scroller">
                <table className="data">
                  <tbody>
                    {meetings.map((m) => (
                      <tr key={m.as_fixture_id}>
                        <td className="m" style={{ color: 'var(--muted)' }}>{day(m.commence_time)}</td>
                        <td className="wrap">{m.home_team}</td>
                        <td className="right m" style={{ fontWeight: 600 }}>
                          {m.home_score ?? '–'}–{m.away_score ?? '–'}
                        </td>
                        <td className="wrap">{m.away_team}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty head="No meetings on record" body="Our fixture history starts in 2021 and covers this competition only." />
            )}
          </Card>

          <Card title="Recent form" sub="Most recent first">
            {homeForm.length || awayForm.length ? (
              <div style={{ padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <FormLine label={homeLabel} names={d.homeNames} rows={homeForm} />
                <FormLine label={awayLabel} names={d.awayNames} rows={awayForm} />
              </div>
            ) : (
              <Empty head="No completed fixtures on record" body="Form appears once this competition has results in our history." />
            )}
          </Card>
        </div>

        {/* ---------------- result ---------------- */}
        {!upcoming && lastResult ? (
          <Card title="Last time they met">
            <div style={{ padding: '18px 24px', fontSize: 15, color: 'var(--ink)' }}>
              <span className="m">{day(lastResult.commence_time)}</span>
              {' — '}
              {lastResult.home_team} <span className="m" style={{ fontWeight: 600 }}>{lastResult.home_score ?? '–'}–{lastResult.away_score ?? '–'}</span> {lastResult.away_team}
            </div>
          </Card>
        ) : null}

        {/* ---------------- prose ---------------- */}
        <section style={{ maxWidth: 760 }}>
          <h2 style={{ marginBottom: 12 }}>Where to find the best {homeLabel} v {awayLabel} odds</h2>
          <p>
            Every price on this page is the best currently offered by the {bookRows.count || 'listed'} bookmakers in our feed,
            checked twice a day. Next to each we show the <b>fair price</b>: every book&rsquo;s own margin stripped out,
            then averaged, which is what the market thinks the outcome is worth before the bookmaker&rsquo;s cut.
            The gap between the two is what shopping around is worth on this match.
          </p>
          <p>
            The model column is separate and does not look at prices at all. It is a Poisson attack and defence
            model fitted on results, with the league baseline restored and shrinkage applied to clubs with short
            histories. Where a market has not beaten a naive baseline out of sample, we say so instead of
            publishing a number.
          </p>
          {tier >= 3 ? (
            <p style={{ color: 'var(--muted)' }}>
              These clubs are not currently scheduled to meet, so this page is a record rather than a preview.
            </p>
          ) : null}
          <div className="pageFoot">
            Odds change constantly — always confirm the price at the bookmaker before betting. 18+.
          </div>
        </section>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(homeLabel, awayLabel, league.leagueName, upcoming)) }}
      />
    </div>
  );
}

/* --------------------------- helpers ------------------------------ */

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
function opTag(o: { model: string; commission_rate: string | null }): string {
  if (o.model !== 'exchange') return o.model.replace(/_/g, ' ');
  const cr = num(o.commission_rate);
  return cr == null
    ? 'exchange, commission not published'
    : `exchange, ${pct(cr, 0)} commission`;
}
