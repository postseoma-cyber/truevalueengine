import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'How the Engine Works — Margins, Fair Prices and the Model',
  description:
    'What we measure, how the fair price is computed, what the model does and does not do, and every limitation we know about.',
  alternates: { canonical: '/how-the-engine-works/' },
};

export default function How() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'How the engine works' }]} />
      <header style={{ padding: '14px 0 20px', maxWidth: 820 }}>
        <h1>How the engine works</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Two separate things happen on a fixture page, and it matters that they stay separate: what
          the market says, and what our model says.
        </p>
      </header>

      <div className="stack">
        <Card title="1 — The margin, and the fair price" lead>
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <p style={{ marginTop: 0 }}>
              Every bookmaker&rsquo;s prices on a market imply a set of probabilities. Turn each price
              into <span className="m">1 / price</span> and add them up: an honest set would total
              100%. A real book totals more — 104%, 106% — and the excess is the margin it keeps.
            </p>
            <p>
              We divide each book&rsquo;s implied probabilities by its own total, which removes that
              book&rsquo;s margin without touching its opinion. Then we take the median across every
              book pricing the market. That median is the <b>fair price</b> shown next to the best
              price: the market&rsquo;s view with the bookmaker&rsquo;s cut taken out.
            </p>
            <p style={{ marginBottom: 0 }}>
              The median rather than the mean, because a single stale or mistaken price should not move
              the benchmark. And per book rather than pooled, because a book with a fat margin would
              otherwise drag the consensus toward itself.
            </p>
          </div>
        </Card>

        <Card title="2 — The model">
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <p style={{ marginTop: 0 }}>
              A Poisson attack-and-defence model. Each club carries an attack rating and a defence
              rating; a league baseline sets the scoring level of the competition it plays in; home
              advantage is fitted rather than assumed. Recent matches count for more than old ones on a
              180-day half-life. Clubs with short histories are shrunk toward their league average, so
              a promoted side with eight matches on record does not get an extreme rating from a small
              sample.
            </p>
            <p>
              The model never looks at bookmaker prices. It is fitted on results and scored against
              results. When we say the model makes a team 38% to win, that is the model&rsquo;s own
              number, published unblended — we do not nudge it toward the market to make it look
              sharper.
            </p>
            <p style={{ marginBottom: 0 }}>
              The edge is then simply <span className="m">model probability × best price − 1</span>.
              A positive edge means our number and the best available price disagree in our favour.
              It does not mean we are right.{' '}
              <Link href="/model/accuracy/">Here is where the model is measurably wrong.</Link>
            </p>
          </div>
        </Card>

        <Card title="3 — What we withhold, and why we say so">
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <p style={{ marginTop: 0 }}>
              A market is only published once it beats a naive baseline out of sample. Right now that
              is match result and nothing else. Where a market or a competition fails that test, the
              page says the number is withheld and gives the reason, rather than quietly leaving a gap.
            </p>
            <p style={{ marginBottom: 0 }}>
              The two reasons you will see most: <b>thin league history</b>, meaning the competition has
              too few matches on record for a rating to mean anything; and{' '}
              <b>market not validated</b>, meaning the model has no demonstrated skill in that market.
            </p>
          </div>
        </Card>

        <Card title="4 — What we cannot do">
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <ul style={{ marginTop: 0, paddingLeft: 18 }}>
              <li>Lineups, injuries and suspensions — not in our data feed.</li>
              <li>Live in-play prices. Everything here is pre-match, checked twice a day.</li>
              <li>Odds history before 2026. We started recording on 2 September 2026; a movement chart appears only once a line has actually moved.</li>
              <li>Cup and continental ties. Rating a match between clubs from different pyramids needs a cross-league strength estimate, and our fixture history does not connect the leagues well enough to fit one honestly.</li>
              <li>Exchange prices as a benchmark. Our fair price is a no-vig consensus of bookmakers, not an exchange price. Where an exchange publishes a standard commission we net it off before comparing; where it does not, the exchange still informs the consensus but cannot win best price.</li>
            </ul>
          </div>
        </Card>

        <div className="pageFoot" style={{ maxWidth: 780 }}>
          Nothing on this site is a tip or advice. It is a measurement, with its error bars stated.
          Odds change constantly — always confirm at the bookmaker. 18+.
        </div>
      </div>
    </div>
  );
}
