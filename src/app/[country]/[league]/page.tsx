import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { leagueFromPath, teamIndex, matchupHref } from '@/lib/resolve';
import { LEAGUES, leaguesByCountry } from '@/lib/leagues';
import { competitionFixtures, pricedCompetitions } from '@/lib/queries';
import { Breadcrumb } from '@/components/Chrome';
import { Card, Empty } from '@/components/Modules';
import { kickoff, day, fit, clamp } from '@/lib/fmt';

export const revalidate = 3600;

type Params = { country: string; league: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const l = leagueFromPath(p.country, p.league);
  if (!l) return { title: 'Not found', robots: { index: false, follow: false } };
  const year = new Date().getFullYear();
  return {
    title: fit(`${l.leagueName} Odds & Predictions ${year}`, `${l.shortName} Odds & Predictions ${year}`),
    description: clamp(
      `Every ${l.leagueName} fixture with the best bookmaker price, each book's ` +
        `measured margin, and our model's 1X2 probabilities. Free, no signup.`,
    ),
    alternates: { canonical: `/${l.country}/${l.league}/` },
  };
}

export default async function LeaguePage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const league = leagueFromPath(p.country, p.league);
  if (!league) notFound();

  const [fixtures, priced, idx] = await Promise.all([
    competitionFixtures(league.competitionId, 60, 30),
    pricedCompetitions(),
    teamIndex(league.competitionId),
  ]);
  const pricedIds = new Set(priced.map((r) => r.competition_id));
  const now = Date.now();
  const upcoming = fixtures.filter((f) => !f.completed && +new Date(f.commence_time) > now - 3 * 3600_000);
  const results = fixtures.filter((f) => f.completed).reverse();
  const siblings = (leaguesByCountry().get(league.country) ?? []).filter((l) => l.league !== league.league);

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb
        trail={[
          { href: '/', label: 'Football' },
          { href: `/${league.country}/`, label: league.countryName },
          { label: league.leagueName },
        ]}
      />
      <header style={{ padding: '14px 0 20px' }}>
        <h1>{league.leagueName} odds and predictions</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 720 }}>
          {league.countryName}. Every scheduled fixture below links to a page with the best price on
          each outcome, the fair price with bookmaker margin stripped out, and every book&rsquo;s own
          overround on that match.
          {!pricedIds.has(league.competitionId) ? ' No fixture in this competition is currently priced.' : ''}
        </p>
      </header>

      <div className="stack">
        <Card title="Scheduled" sub={upcoming.length ? `${upcoming.length} fixtures` : undefined}>
          {upcoming.length ? (
            <div className="scroller">
              <table className="data">
                <thead>
                  <tr><th>Kick-off</th><th className="wrap">Fixture</th><th className="right">Page</th></tr>
                </thead>
                <tbody>
                  {upcoming.map((f) => {
                    const href = matchupHref(idx, league.country, league.league, f.home_team, f.away_team);
                    return (
                      <tr key={f.event_id}>
                        <td className="m" style={{ color: 'var(--muted)' }}>{kickoff(f.commence_time)}</td>
                        <td className="wrap"><Link href={href}>{f.home_team} v {f.away_team}</Link></td>
                        <td className="right"><Link href={href}>Odds &amp; prediction →</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="Nothing scheduled" body="No fixture in this competition falls inside the next 30 days of our feed." />
          )}
        </Card>

        <Card title="Recent results" sub={results.length ? `Last ${Math.min(results.length, 40)}` : undefined}>
          {results.length ? (
            <div className="scroller">
              <table className="data">
                <tbody>
                  {results.slice(0, 40).map((f) => (
                    <tr key={f.event_id}>
                      <td className="m" style={{ color: 'var(--muted)' }}>{day(f.commence_time)}</td>
                      <td className="wrap">
                        <Link href={matchupHref(idx, league.country, league.league, f.home_team, f.away_team)}>
                          {f.home_team} v {f.away_team}
                        </Link>
                      </td>
                      <td className="right m" style={{ fontWeight: 600 }}>
                        {f.home_score ?? '–'}–{f.away_score ?? '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="No results yet" body="Results appear once a fixture in this competition has finished." />
          )}
        </Card>

        <Card title="Elsewhere">
          <div style={{ padding: '16px 24px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
            <Link href={`/margins/${league.league}/`}>Bookmaker margins in {league.shortName} →</Link>
            {siblings.map((s) => (
              <Link key={s.league} href={`/${s.country}/${s.league}/`}>{s.leagueName}</Link>
            ))}
            <Link href={`/${league.country}/`}>All {league.countryName} competitions</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return LEAGUES.map((l) => ({ country: l.country, league: l.league }));
}
