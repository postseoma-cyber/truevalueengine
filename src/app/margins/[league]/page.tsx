import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEAGUES } from '@/lib/leagues';
import { leagueMargins } from '@/lib/queries';
import { Card, Empty, MarginBar, bookName } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';
import { num, pct, kickoff, fit } from '@/lib/fmt';

export const revalidate = 21600;

type Params = { league: string };

function find(slug: string) {
  return LEAGUES.find((l) => l.league === slug) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const l = find(p.league);
  if (!l) return { title: 'Not found', robots: { index: false, follow: false } };
  const year = new Date().getFullYear();
  return {
    title: fit(
      `${l.leagueName} Bookmaker Margins ${year}`,
      `${l.countryName} ${l.shortName} Margins ${year}`,
    ),
    description: `Every bookmaker ranked by the margin we measured in their ${l.leagueName} match-result prices over the last 30 days, with sample sizes.`,
    alternates: { canonical: `/margins/${l.league}/` },
  };
}

export default async function LeagueMargins({ params }: { params: Promise<Params> }) {
  const p = await params;
  const league = find(p.league);
  if (!league) notFound();

  const rows = await leagueMargins(league.competitionId, 30);
  const worst = rows.length ? num(rows[rows.length - 1].margin_median) ?? 0 : 0;

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb
        trail={[
          { href: '/', label: 'Football' },
          { href: '/margins/', label: 'Bookmaker margins' },
          { label: league.leagueName },
        ]}
      />
      <header style={{ padding: '14px 0 20px', maxWidth: 780 }}>
        <h1>{league.leagueName} bookmaker margins</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Measured from each book&rsquo;s own match-result prices over the last 30 days. The median is
          shown rather than the mean, because one mispriced market would drag an average around.
        </p>
      </header>

      <div className="stack">
        <Card title="Ranked, lowest margin first" sub={rows.length ? `${rows.length} books with at least 5 complete markets` : undefined} lead>
          {rows.length ? (
            <>
              <div style={{ padding: '18px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rows.slice(0, 10).map((r) => (
                  <MarginBar key={r.bookmaker_key} label={bookName(r.bookmaker_key)} margin={num(r.margin_median) ?? 0} worst={worst} />
                ))}
              </div>
              <div className="scroller">
                <table className="data">
                  <thead>
                    <tr><th className="wrap">Bookmaker</th><th className="right">Median margin</th><th className="right">Mean</th><th className="right">Markets</th><th className="right">Last seen</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.bookmaker_key}>
                        <td className="wrap">{bookName(r.bookmaker_key)}</td>
                        <td className="right m" style={{ fontWeight: 600 }}>{pct(num(r.margin_median), 2)}</td>
                        <td className="right m">{pct(num(r.margin_mean), 2)}</td>
                        <td className="right m" style={{ color: 'var(--muted)' }}>{r.n}</td>
                        <td className="right m" style={{ color: 'var(--muted)' }}>{kickoff(r.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty
              head="No margin measured in this competition yet"
              body="This needs at least five complete match-result markets from a book in the last 30 days. Out-of-season competitions will be empty."
            />
          )}
        </Card>

        <Card title="Elsewhere">
          <div style={{ padding: '16px 24px 20px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Link href={`/${league.country}/${league.league}/`}>{league.leagueName} fixtures →</Link>
            <Link href="/margins/">All competitions →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return LEAGUES.map((l) => ({ league: l.league }));
}
