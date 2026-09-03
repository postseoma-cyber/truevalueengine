import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'How Our Model Scores — Log Loss, Brier and Where It Is Wrong',
  description:
    'Walk-forward accuracy of our football model against base rates, market by market — including the markets that failed and the bias we have measured.',
  alternates: { canonical: '/model/accuracy/' },
};

export default function Accuracy() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Model accuracy' }]} />
      <header style={{ padding: '14px 0 20px', maxWidth: 820 }}>
        <h1>How the model scores</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Most prediction sites never publish this. Everything below is walk-forward: the model is
          refitted each week on matches strictly before that week, then prices the week that follows.
          No number here saw its own answer. Measured on <span className="m">10,195</span> matches over
          a 365-day window.
        </p>
      </header>

      <div className="stack">
        <Card title="Match result (1X2)" sub="Lower is better for both metrics" lead
          foot={<span>The model beats the base rate on both metrics, which is the minimum bar for publishing anything at all.</span>}>
          <div className="scroller">
            <table className="data">
              <thead><tr><th className="wrap">Model</th><th className="right">Log loss</th><th className="right">Brier</th></tr></thead>
              <tbody>
                <tr><td className="wrap">Our model</td><td className="right m" style={{ fontWeight: 600 }}>1.0286</td><td className="right m" style={{ fontWeight: 600 }}>0.6172</td></tr>
                <tr><td className="wrap">Competition base rates</td><td className="right m">1.0737</td><td className="right m">0.6495</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Where the model is wrong" sub="Aggregate calibration over the same 10,195 matches"
          foot={<span>This is the reason we say an away-side edge is the least trustworthy number the engine produces.</span>}>
          <div className="scroller">
            <table className="data">
              <thead><tr><th className="wrap">Outcome</th><th className="right">Model says</th><th className="right">Actually happened</th><th className="right">Gap</th></tr></thead>
              <tbody>
                <tr><td className="wrap">Home win</td><td className="right m">43.79%</td><td className="right m">43.71%</td><td className="right m">−0.08 pp</td></tr>
                <tr><td className="wrap">Draw</td><td className="right m">24.85%</td><td className="right m">26.07%</td><td className="right m"><span className="tag tag--bad m">+1.22 pp</span></td></tr>
                <tr><td className="wrap">Away win</td><td className="right m">31.36%</td><td className="right m">30.22%</td><td className="right m"><span className="tag tag--bad m">−1.13 pp</span></td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ padding: '18px 24px 22px', maxWidth: 760 }}>
            <p style={{ marginTop: 0 }}>
              Home is essentially perfect. The model under-predicts draws by about 1.2 points and
              over-predicts away wins by about 1.1, and those are the same error seen from both ends.
              The bias is stable across probability bands rather than being noise in one bucket: at a
              54% away price the true rate is nearer 49%.
            </p>
            <p style={{ marginBottom: 0 }}>
              A calibration stage that corrects exactly this has been built and validated on held-out
              data. It is not deployed yet. Until it is, treat published away-win edges with more
              suspicion than home or draw edges — the numbers on this site are published as the model
              computes them, including where we know the model leans.
            </p>
          </div>
        </Card>

        <Card title="Markets that failed" sub="Tested and not published">
          <div className="scroller">
            <table className="data">
              <thead><tr><th className="wrap">Market</th><th className="wrap">Verdict</th></tr></thead>
              <tbody>
                <tr><td className="wrap">Match result (1X2)</td><td className="wrap">Beats base rates out of sample. <b>Published.</b></td></tr>
                <tr><td className="wrap">Over/under goals</td><td className="wrap">Did not beat the naive baseline. Withheld.</td></tr>
                <tr><td className="wrap">Both teams to score</td><td className="wrap">Did not beat the naive baseline. Withheld.</td></tr>
                <tr><td className="wrap">Handicap</td><td className="wrap">Did not beat the naive baseline. Withheld.</td></tr>
                <tr><td className="wrap">Cards and corners</td><td className="wrap">Did not beat the naive baseline. Withheld.</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Repairs we tested and rejected" sub="Published because a rejected experiment is still evidence">
          <div style={{ padding: '18px 24px 22px', maxWidth: 760 }}>
            <p style={{ marginTop: 0 }}>
              <b>Dixon–Coles low-score correction.</b> Reweights the 0-0, 1-0, 0-1 and 1-1 cells with one
              parameter. Best case bought 0.03% of log loss, and nothing at all on goals markets — all
              four cells it touches sit on the same side of 2.5 goals. Implemented, defaulted off.
            </p>
            <p>
              <b>Lifting the draw diagonal.</b> A more direct answer to the measured draw bias. The
              parameter transfers between halves of the window, which says the bias is real — but it
              buys about 0.04% of log loss held out. Implemented, defaulted off.
            </p>
            <p style={{ marginBottom: 0 }}>
              <b>A two-parameter calibration stage.</b> Temperature and a draw shift, fitted on outcomes
              and never on market prices. Buys 0.08% held out and improves both metrics rather than
              trading one for the other. This is the one worth deploying, and it is queued.
            </p>
          </div>
        </Card>

        <div className="pageFoot" style={{ maxWidth: 760 }}>
          These figures are recomputed by hand at present, most recently on 3 September 2026.
          Automating them onto this page is a known gap, not a finished feature.{' '}
          <Link href="/model/record/">The forward-only record is here.</Link>
        </div>
      </div>
    </div>
  );
}
