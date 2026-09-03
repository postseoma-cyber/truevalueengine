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
import { Card, Empty, bookName } from '@/components/Modules';
import { OddsFormatSwitcher, Price } from '@/components/Price';
// `Tier` is already the T1-T4 corpus type from @/lib/tier, so the badge
// component is aliased rather than shadowing a concept that means
// something else entirely.
import { Ladder, Tier as TierBadge, signed } from '@/components/Board';
import { buildLines, ValueTable, BookGrid, LineSay } from '@/components/Market';
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
    league, homeLabel, awayLabel, upcoming, lastResult, meetings, homeForm, awayForm,
  } = d;

  const kickoffText = upcoming ? kickoff(upcoming.commence_time) : null;
  const fx = upcoming ?? lastResult ?? null;

  // THE BOARD. Every bookmaker on every outcome, split into markets and lines,
  // because a reader wants a small table per market -- not a thousand rows.
  const value = fx ? await fixtureValue(fx.event_id) : [];
  const lines = buildLines(value, homeLabel, awayLabel);
  const bookCount = new Set(value.map((v) => v.bookmaker_key)).size;

  // The headline bet is simply the largest overpay on the board. Nothing is
  // withheld: where our model and fifty bookmakers disagree, the page prints
  // both numbers side by side and says which is the likelier to be wrong.
  const call = lines
    .flatMap((l) => l.outcomes.map((o) => ({ line: l, o })))
    .filter((x) => x.o.edge !== null && (x.o.edge as number) > 0)
    .sort((a, b) => (b.o.edge as number) - (a.o.edge as number))[0] ?? null;
  const worstOn = call
    ? call.o.rows[call.o.rows.length - 1]
    : null;
  const worstEdge = worstOn ? (num(worstOn.price) ?? 0) * (call as NonNullable<typeof call>).o.ref - 1 : 0;
  // How far our own number sits from the market's. Printed whenever it is wide,
  // because a reader is owed the disagreement, not a filtered view of it.
  const stretch = call && call.o.usesModel
    ? (call.o.modelProb as number) - call.o.marketProb
    : null;

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
            <span><span className="num">{bookCount}</span> bookmakers compared</span>
          </div>
        </div>
        <OddsFormatSwitcher />
      </header>

      {call ? (
        <Card
          title="THE BIGGEST OVERPAY ON THIS MATCH"
          sub={`${call.line.title} · ${call.o.label}`}
          lead
        >
          <div className="call">
            <div className="call-pick">
              <div className="kicker">BACK THIS</div>
              <div className="call-name">{call.o.label}</div>
              <div className="call-price">
                <span className="num"><Price value={num(call.o.best!.price) ?? 0} /></span>
                <span className="call-at">best price at {bookName(call.o.best!.bookmaker_key)}</span>
              </div>
              <p className="call-say">
                We make this <strong className="num">{(call.o.ref * 100).toFixed(1)}%</strong> to
                happen, so a fair price would be{' '}
                <strong className="num">{call.o.fair.toFixed(2)}</strong>.{' '}
                {bookName(call.o.best!.bookmaker_key)} is offering{' '}
                <strong className="num"><Price value={num(call.o.best!.price) ?? 0} /></strong> —
                paying you <strong className="pay-up num">{signed(call.o.edge as number)}</strong>{' '}
                more than the bet is worth.{worstOn && worstOn.bookmaker_key !== call.o.best!.bookmaker_key ? (
                  <> The same bet at {bookName(worstOn.bookmaker_key)} pays{' '}
                  <strong className="num"><Price value={num(worstOn.price) ?? 0} /></strong>, which
                  is <strong className="pay-down num">{signed(worstEdge)}</strong> — the same wager,{' '}
                  <strong className="num">
                    {(((call.o.edge as number) - worstEdge) * 100).toFixed(1)}
                  </strong> percentage points of your stake apart.</>
                ) : null}
              </p>
            </div>
            <div className="call-nums">
              <div>
                <div className="kicker">{call.o.usesModel ? 'OUR MODEL' : 'THE MARKET'}</div>
                <div className="big num">{(call.o.ref * 100).toFixed(1)}<span>%</span></div>
                <div className="cap">Chance of it happening</div>
              </div>
              <div>
                <div className="kicker">FAIR PRICE</div>
                <div className="big num">{call.o.fair.toFixed(2)}</div>
                <div className="cap">What you should be paid, with no margin</div>
              </div>
              <div>
                <div className="kicker">BEST BOOK PAYS</div>
                <div className="big num pay-up">{signed(call.o.edge as number)}</div>
                <div className="cap">More than fair, per unit staked</div>
              </div>
              <div>
                <div className="kicker">WORST BOOK PAYS</div>
                <div className="big num pay-down">{signed(worstEdge)}</div>
                <div className="cap">
                  {worstOn ? <>Less than fair, at {bookName(worstOn.bookmaker_key)}</> : '—'}
                </div>
              </div>
            </div>
          </div>
          {stretch !== null && Math.abs(stretch) >= 0.05 ? (
            <p className="note">
              <span className="dot" />
              Read this one with your eyes open. Our model makes it{' '}
              <strong className="num">{((call.o.modelProb as number) * 100).toFixed(1)}%</strong>{' '}
              where {call.o.rows[0].n_books} bookmakers, with their margin removed, make it{' '}
              <strong className="num">{(call.o.marketProb * 100).toFixed(1)}%</strong>. A gap that
              wide is far likelier to be our error than theirs. We publish the number unblended
              anyway, and show you the market&rsquo;s beside it, so the disagreement is yours to
              judge.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card title="THE BIGGEST OVERPAY ON THIS MATCH" sub="Nothing is overpriced here">
          <Empty
            head="Every book is pricing this match at or below what it is worth"
            body="That is the normal state of a market. The full tables below still show what each outcome is worth and which bookmaker comes closest to paying it."
          />
        </Card>
      )}

      {lines.length ? lines.map((line) => (
        <Card
          key={line.key}
          title={line.title.toUpperCase()}
          sub={`${line.bookCount} bookmakers`}
        >
          <ValueTable line={line} />
          <LineSay line={line} />
          <BookGrid line={line} limit={6} />
        </Card>
      )) : (
        <Card title="ODDS">
          <Empty head="No prices recorded" body="No bookmaker in our feed is currently pricing this match." />
        </Card>
      )}

      <Card
        title="EVERY BOOKMAKER, OUTCOME BY OUTCOME"
        sub={`${bookCount} books, with each one's own cut on each leg`}
      >
        {lines.length ? lines.map((line) => (
          <div key={line.key}>
            {line.outcomes.map((o) => (
              <section className="outcome" key={line.key + o.selection}>
                <div className="outcome-head">
                  <h3>
                    {o.label}
                    <span className="mkt">{line.title}</span>
                  </h3>
                  <TierBadge source={o.usesModel ? 'model' : 'consensus'} />
                </div>
                <div className="worth">
                  <span className="split">
                    Our model <b className="num">
                      {o.modelProb === null ? 'no price' : (o.modelProb * 100).toFixed(1) + '%'}
                    </b>
                  </span>
                  <span className="split">
                    Market consensus <b className="num">{(o.marketProb * 100).toFixed(1)}%</b>
                  </span>
                  <span className="split">
                    Fair odds <b className="num">{o.fair.toFixed(2)}</b>
                  </span>
                </div>
                <Ladder rows={o.rows} home={homeLabel} away={awayLabel} limit={8} />
              </section>
            ))}
          </div>
        )) : (
          <Empty head="No prices recorded" body="Nothing to compare on this match yet." />
        )}
        <p className="note">
          <span className="dot" />
          &ldquo;Their cut&rdquo; is how much of your stake that bookmaker keeps on that outcome,
          recovered from its own prices. It is not the same on every outcome: books take more for
          backing an outsider than a favourite, and how much more differs enormously between them.
          An unusually generous single price is more often a stale quote than a gift &mdash; we
          publish it as we found it, but check it at the book before you stake.
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
          const fg = res === 'W' ? 'var(--good-fg)' : res === 'L' ? 'var(--bad-fg)' : 'var(--body)';
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
