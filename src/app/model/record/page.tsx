import type { Metadata } from 'next';
import Link from 'next/link';
import { settledRecord, settledBySide, recentSettled, openSelections } from '@/lib/queries';
import { Card, Empty, bookName } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';
import { Price } from '@/components/Price';
import { num, pct, signedPct, day, kickoff } from '@/lib/fmt';

export const revalidate = 1800;

export const metadata: Metadata = {
  title: 'Our Published Record — Every Selection, Won or Lost',
  description:
    'Every selection this model has published, timestamped before kick-off and settled afterwards. Losses included, sample sizes shown, no claim beyond them.',
  alternates: { canonical: '/model/record/' },
};

export default async function Record() {
  const [totals, bySide, recent, open] = await Promise.all([
    settledRecord(), settledBySide(), recentSettled(60), openSelections(60),
  ]);

  const published = totals.find((t) => t.bucket === 'Published');
  const n = published?.n ?? 0;

  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Record' }]} />
      <header style={{ padding: '14px 0 20px', maxWidth: 820 }}>
        <h1>The published record</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Forward-only. Every selection below was written to the ledger before kick-off and settled
          from the result afterwards. A &ldquo;selection&rdquo; means a published outcome the model
          rated above the best available price — the ledger also stores every price we display, and
          those are not bets. Mixing the two produces a meaningless number, so we never report them together.
        </p>
      </header>

      <div className="stack">
        <Card
          title="Settled selections"
          sub={n ? `${n} settled` : undefined}
          lead
          foot={
            n < 200 ? (
              <span>
                <b>{n} settled selections is far too small to judge a model on.</b> A record needs
                several hundred before return on investment means anything at all. We publish it from
                the first bet anyway, because a record that only appears once it looks good is not a record.
              </span>
            ) : undefined
          }
        >
          {totals.length ? (
            <div className="scroller">
              <table className="data">
                <thead><tr><th className="wrap">Group</th><th className="right">Selections</th><th className="right">Won</th><th className="right">Units</th><th className="right">ROI</th></tr></thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.bucket}>
                      <td className="wrap">{t.bucket}{t.bucket === 'Withheld' ? ' (not shown on the site)' : ''}</td>
                      <td className="right m">{t.n}</td>
                      <td className="right m">{t.won}</td>
                      <td className="right m" style={{ fontWeight: 600 }}>{t.units}</td>
                      <td className="right m">{t.roi}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="Nothing settled yet" body="The first selections settle the day after their fixtures finish." />
          )}
        </Card>

        {bySide.length ? (
          <Card title="By side" sub="Published selections only">
            <div className="scroller">
              <table className="data">
                <thead><tr><th className="wrap">Selection</th><th className="right">n</th><th className="right">Won</th><th className="right">Units</th><th className="right">ROI</th></tr></thead>
                <tbody>
                  {bySide.map((r) => (
                    <tr key={r.selection}>
                      <td className="wrap" style={{ textTransform: 'capitalize' }}>{r.selection}</td>
                      <td className="right m">{r.n}</td>
                      <td className="right m">{r.won}</td>
                      <td className="right m">{r.units}</td>
                      <td className="right m">{r.roi}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note">
              <span className="dot" />
              <span>
                Away selections are the group the calibration test says to distrust most —{' '}
                <Link href="/model/accuracy/">the measured bias is here</Link>.
              </span>
            </div>
          </Card>
        ) : null}

        <Card title="Open selections" sub={open.length ? `${open.length} awaiting a result` : undefined}>
          {open.length ? (
            <div className="scroller">
              <table className="data">
                <thead><tr><th>Kick-off</th><th>Selection</th><th className="right">Model</th><th className="right">Price</th><th className="wrap">Book</th><th className="right">Edge</th></tr></thead>
                <tbody>
                  {open.map((r, i) => (
                    <tr key={`${r.event_id}-${r.selection}-${i}`}>
                      <td className="m" style={{ color: 'var(--muted)' }}>{kickoff(r.commence_time)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{r.selection}</td>
                      <td className="right m">{pct(num(r.model_prob))}</td>
                      <td className="right"><Price value={num(r.best_price)} /></td>
                      <td className="wrap">{r.best_book ? bookName(r.best_book) : '—'}</td>
                      <td className="right m">{signedPct(num(r.edge))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="No open selections" body="Nothing the model rates above the market is currently unsettled." />
          )}
        </Card>

        <Card title="Settled, most recent first">
          {recent.length ? (
            <div className="scroller">
              <table className="data">
                <thead><tr><th>Date</th><th>Selection</th><th className="right">Model</th><th className="right">Price</th><th className="wrap">Book</th><th className="right">Edge</th><th className="right">Result</th><th className="right">P/L</th></tr></thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={`${r.event_id}-${r.selection}-${i}`}>
                      <td className="m" style={{ color: 'var(--muted)' }}>{day(r.commence_time)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{r.selection}</td>
                      <td className="right m">{pct(num(r.model_prob))}</td>
                      <td className="right"><Price value={num(r.best_price)} /></td>
                      <td className="wrap">{r.best_book ? bookName(r.best_book) : '—'}</td>
                      <td className="right m">{signedPct(num(r.edge))}</td>
                      <td className="right">
                        <span className={`tag m ${r.won ? 'tag--good' : 'tag--bad'}`}>{r.won ? 'Won' : 'Lost'}</span>
                      </td>
                      <td className="right m">{r.pnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty head="Nothing settled yet" body="This fills in as fixtures finish." />
          )}
        </Card>

        <section style={{ maxWidth: 760 }}>
          <h2 style={{ marginBottom: 12 }}>How to read this honestly</h2>
          <p>
            Return on investment over a few dozen bets is noise. A model with a genuine 2% edge will
            still show a losing month regularly, and a model with no edge at all will show a winning
            one just as often. The figure worth watching is whether winners arrive at roughly the rate
            the model claimed — not the units column.
          </p>
          <p>
            We also record the selections we chose <i>not</i> to publish, so the withholding rules can
            be judged too. If the withheld group performs the same as the published one, the rules are
            not doing anything and we should say so.
          </p>
        </section>
      </div>
    </div>
  );
}
