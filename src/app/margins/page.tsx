import type { Metadata } from 'next';
import Link from 'next/link';
import { LEAGUES } from '@/lib/leagues';
import { leagueMargins, dataAsOf } from '@/lib/queries';
import { Card, Empty, bookName } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';
import { num, pct, kickoff } from '@/lib/fmt';

export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Bookmaker Margins, Measured — Which Books Keep the Least',
  description:
    'Every bookmaker ranked by the margin we actually measured in their published football prices over the last 30 days. Sample size shown for every figure.',
  alternates: { canonical: '/margins/' },
};

export default async function MarginsIndex() {
  // Rank books across the competitions with the deepest price history.
  const sample = LEAGUES.slice(0, 12);
  const results = await Promise.all(sample.map((l) => leagueMargins(l.competitionId, 30)));
  const agg = new Map<string, { n: number; sum: number }>();
  results.flat().forEach((r) => {
    const m = num(r.margin_median);
    if (m == null) return;
    const cur = agg.get(r.bookmaker_key) ?? { n: 0, sum: 0 };
    cur.n += r.n;
    cur.sum += m * r.n;
    agg.set(r.bookmaker_key, cur);
  });
  const table = [...agg.entries()]
    .map(([book, v]) => ({ book, n: v.n, margin: v.sum / v.n }))
    .filter((r) => r.n >= 20)
    .sort((a, b) => a.margin - b.margin);

  const asOf = await dataAsOf();

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Bookmaker margins' }]} />
      <header style={{ padding: '14px 0 20px', maxWidth: 780 }}>
        <h1>Bookmaker margins, measured</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Margin — the overround, the vig, the book&rsquo;s cut — is what a bookmaker keeps on a market
          where every outcome is covered. A 5% margin means the prices add up to 105% of certainty, and
          the 5% is theirs. Below is what we measured in each book&rsquo;s own published prices, not what
          anyone claims. Every figure carries the number of markets behind it.
        </p>
      </header>

      <div className="stack">
        <Card
          title="Match-result margin, all leagues"
          sub="Median per competition, weighted by markets observed, last 30 days"
          lead
          foot={
            asOf?.odds ? (
              <span>Measured from prices captured up to <span className="m">{kickoff(asOf.odds)}</span>. A book appears once we have at least 20 complete markets from it.</span>
            ) : undefined
          }
        >
          {table.length ? (
            <div className="scroller">
              <table className="data">
                <thead>
                  <tr><th className="right">#</th><th className="wrap">Bookmaker</th><th className="right">Margin</th><th className="right">Markets measured</th></tr>
                </thead>
                <tbody>
                  {table.map((r, i) => (
                    <tr key={r.book}>
                      <td className="right m" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                      <td className="wrap">{bookName(r.book)}</td>
                      <td className="right m" style={{ fontWeight: 600 }}>{pct(r.margin, 2)}</td>
                      <td className="right m" style={{ color: 'var(--muted)' }}>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="Not enough measured markets yet" body="A margin needs a complete set of prices from one book on one market. We publish none until there are at least 20." />
          )}
        </Card>

        <Card title="By competition" sub="Margins differ a lot between a top division and a second tier">
          <div style={{ padding: '18px 24px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '8px 20px' }}>
            {LEAGUES.map((l) => (
              <Link key={l.league} href={`/margins/${l.league}/`} style={{ fontSize: 13 }}>
                {l.leagueName} <span style={{ color: 'var(--faint)' }}>· {l.countryName}</span>
              </Link>
            ))}
          </div>
        </Card>

        <section style={{ maxWidth: 760 }}>
          <h2 style={{ marginBottom: 12 }}>Why the margin matters more than the bonus</h2>
          <p>
            A welcome offer is paid once. A margin is paid on every bet you ever place. On a
            three-outcome football market, the difference between a 2% book and a 6% book is roughly
            four percentage points of every stake, forever — far more than any sign-up bonus returns.
          </p>
          <p>
            Two honest caveats. First, a low headline margin can hide a book that shades one side
            heavily; that is why the per-match tables show each outcome. Second, exchange margins are
            measured before commission, so an exchange that looks unbeatable here charges its cut when
            you win. Where we know a published commission rate we net it off before comparing prices.
          </p>
        </section>
      </div>
    </div>
  );
}
