import type { Metadata } from 'next';
import Link from 'next/link';
import { valueSelections, bookCount, dataAsOf, pricedCompetitions } from '@/lib/queries';
import { Card } from '@/components/Modules';
import { withHref } from '@/lib/resolve';
import { ValueList } from '@/components/ValueList';
import { BY_ID, LEAGUES } from '@/lib/leagues';
import { kickoff } from '@/lib/fmt';

export const revalidate = 900;

export const metadata: Metadata = {
  // 51 characters. The homepage was the one page over the 60-char budget the
  // rest of the site is held to; "Measured" was the word doing the least work.
  title: 'True Value Engine — Bookmaker Margins and Model Odds',
  description:
    'The best price on every football outcome, next to the fair price with each bookmaker’s margin stripped out. Model probabilities published unblended.',
  alternates: { canonical: '/' },
};

export default async function Home() {
  const [raw, books, asOf, priced] = await Promise.all([
    valueSelections(48, 12), bookCount(), dataAsOf(), pricedCompetitions(),
  ]);
  const rows = await withHref(raw);
  const pricedLeagues = priced.map((r) => BY_ID.get(r.competition_id)).filter(Boolean);

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <header style={{ padding: '32px 0 24px', maxWidth: 820 }}>
        <h1 style={{ fontSize: 34 }}>Every bookmaker&rsquo;s margin, measured. Then our own number.</h1>
        <p style={{ marginTop: 12, fontSize: 15, maxWidth: 700 }}>
          We compare <span className="m">{books}</span> bookmakers on every football fixture we cover,
          strip each book&rsquo;s own margin out of its prices to get a fair price, and publish what our
          model makes the same outcome. The model is published exactly as it computes — unblended —
          and its record is on the site whether it is good or bad.
        </p>
        <div style={{ display: 'flex', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
          <Link href="/today/" style={{ padding: '10px 16px', background: '#0f172a', color: '#fff', borderRadius: 5, fontSize: 13, fontWeight: 500 }}>
            Today&rsquo;s selections
          </Link>
          <Link href="/margins/" style={{ padding: '10px 16px', border: '1px solid var(--line)', background: '#fff', borderRadius: 5, fontSize: 13 }}>
            Which books are cheapest
          </Link>
          <Link href="/model/accuracy/" style={{ padding: '10px 16px', border: '1px solid var(--line)', background: '#fff', borderRadius: 5, fontSize: 13 }}>
            How the model scores
          </Link>
        </div>
      </header>

      <div className="stack">
        <Card
          title="Next up"
          sub="Where the model disagrees with the best available price"
          lead
          foot={<span>Every selection is timestamped before kick-off and settled afterwards, win or lose. <Link href="/model/record/">See the record</Link>.</span>}
        >
          <ValueList rows={rows} />
        </Card>

        <Card title="Competitions being priced now" sub={`${pricedLeagues.length} of ${LEAGUES.length} covered competitions have a priced fixture`}>
          <div style={{ padding: '18px 24px 22px', display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            {pricedLeagues.length ? (
              pricedLeagues.map((l) => (
                <Link key={l!.league} href={`/${l!.country}/${l!.league}/`} style={{ fontSize: 13 }}>
                  {l!.leagueName}
                </Link>
              ))
            ) : (
              <span style={{ color: 'var(--muted)' }}>No competition has a priced fixture right now.</span>
            )}
          </div>
          <div className="note">
            <span className="dot" />
            <span>
              <Link href="/country/">All {LEAGUES.length} competitions by country</Link>
              {asOf?.odds ? <> · odds last checked <span className="m">{kickoff(asOf.odds)}</span></> : null}
            </span>
          </div>
        </Card>

        <div className="rail">
          <Card title="What makes this different" sub="In one paragraph">
            <div style={{ padding: '18px 24px 22px' }}>
              <p style={{ marginTop: 0 }}>
                Bookmaker margin is the number nobody publishes. OddsPortal computes it and then renders
                its match pages in JavaScript, so search engines never see it. Everyone else leads with a
                welcome bonus. We measure each book&rsquo;s overround on every market we collect and show it
                next to the price, so you can see what a book keeps before you take its odds.
              </p>
              <p style={{ marginBottom: 0 }}>
                <Link href="/margins/">Bookmaker margin tables →</Link>
              </p>
            </div>
          </Card>
          <Card title="What we will not do" sub="Stated up front">
            <div style={{ padding: '18px 24px 22px' }}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Publish a number for a market that has not beaten a naive baseline out of sample.</li>
                <li>Hide a losing selection. The record includes every published bet.</li>
                <li>Blend the model toward the bookmakers to make it look sharper than it is.</li>
                <li>Quietly drop a figure — where something is withheld, the page says so and why.</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
