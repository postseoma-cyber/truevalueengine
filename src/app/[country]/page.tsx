import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { leaguesByCountry, COUNTRIES } from '@/lib/leagues';
import { competitionFixtures } from '@/lib/queries';
import { Breadcrumb } from '@/components/Chrome';
import { Card, Empty } from '@/components/Modules';
import { teamIndex, matchupHref } from '@/lib/resolve';
import { kickoff, fit, clamp } from '@/lib/fmt';

export const revalidate = 3600;

type Params = { country: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const leagues = leaguesByCountry().get(p.country);
  if (!leagues?.length) return { title: 'Not found', robots: { index: false, follow: false } };
  const name = leagues[0].countryName;
  const year = new Date().getFullYear();
  return {
    title: fit(`${name} Football Odds & Predictions ${year}`, `${name} Football Odds ${year}`),
    description: clamp(`Every ${name} competition we cover, with the best bookmaker price on each fixture and our model's 1X2 probabilities.`),
    alternates: { canonical: `/${p.country}/` },
  };
}

export default async function CountryPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const leagues = leaguesByCountry().get(p.country);
  if (!leagues?.length) notFound();
  const name = leagues[0].countryName;

  const perLeague = await Promise.all(
    leagues.map(async (l) => ({
      league: l,
      fixtures: (await competitionFixtures(l.competitionId, 0, 14)).slice(0, 8),
      idx: await teamIndex(l.competitionId),
    })),
  );

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { href: '/country/', label: 'Countries' }, { label: name }]} />
      <header style={{ padding: '14px 0 20px' }}>
        <h1>{name} football odds</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 720 }}>
          {leagues.length === 1 ? 'One competition' : `${leagues.length} competitions`} covered, with the
          best price on every outcome and each bookmaker&rsquo;s measured margin.
        </p>
      </header>

      <div className="stack">
        {perLeague.map(({ league, fixtures, idx }) => (
          <Card
            key={league.league}
            title={league.leagueName}
            sub={fixtures.length ? `${fixtures.length} fixtures in the next 14 days` : 'No fixtures in the next 14 days'}
          >
            {fixtures.length ? (
              <div className="scroller">
                <table className="data">
                  <tbody>
                    {fixtures.map((f) => (
                      <tr key={f.event_id}>
                        <td className="m" style={{ color: 'var(--muted)' }}>{kickoff(f.commence_time)}</td>
                        <td className="wrap">
                          <Link href={matchupHref(idx, league.country, league.league, f.home_team, f.away_team)}>
                            {f.home_team} v {f.away_team}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty head="Out of season, or between rounds" body="Fixtures appear here as soon as bookmakers open a market on them." />
            )}
            <div className="note">
              <span className="dot" />
              <Link href={`/${league.country}/${league.league}/`}>All {league.leagueName} fixtures and results →</Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return COUNTRIES.map((c) => ({ country: c.slug }));
}
