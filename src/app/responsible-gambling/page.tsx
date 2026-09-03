import type { Metadata } from 'next';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;
export const metadata: Metadata = {
  title: 'Responsible Gambling',
  description: 'Betting should cost you no more than you decided to spend. Where to get help, and how to set limits.',
  alternates: { canonical: '/responsible-gambling/' },
};

export default function RG() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Responsible gambling' }]} />
      <header style={{ padding: '14px 0 20px', maxWidth: 780 }}>
        <h1>Responsible gambling</h1>
      </header>
      <div className="stack">
        <Card title="The honest version" lead>
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <p style={{ marginTop: 0 }}>
              Bookmakers make money because their prices total more than 100%. That is the whole
              business. This site exists to show you exactly how much more, and to be straight about
              how small any advantage on the other side is — a genuine edge in a mainstream football
              market is a couple of percent, not twenty.
            </p>
            <p style={{ marginBottom: 0 }}>
              Nothing here is advice, a tip, or a prediction you should act on. Treat any stake as money
              you have decided to spend, not money you expect to get back.
            </p>
          </div>
        </Card>
        <Card title="Practical limits worth setting">
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <ul style={{ marginTop: 0, paddingLeft: 18 }}>
              <li>A deposit limit, set at the bookmaker, before you need it.</li>
              <li>A time limit or reality check reminder.</li>
              <li>Self-exclusion, which every licensed operator must offer.</li>
            </ul>
          </div>
        </Card>
        <Card title="Where to get help">
          <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
            <ul style={{ marginTop: 0, paddingLeft: 18 }}>
              <li><b>United Kingdom</b> — GamCare, 0808 8020 133, gamcare.org.uk. National self-exclusion: GAMSTOP.</li>
              <li><b>Ireland</b> — Problem Gambling Ireland, problemgambling.ie.</li>
              <li><b>Norway</b> — Hjelpelinjen, 800 800 40.</li>
              <li><b>United States</b> — 1-800-GAMBLER.</li>
              <li><b>Canada</b> — ConnexOntario, 1-866-531-2600.</li>
              <li><b>Australia</b> — Gambling Help Online, 1800 858 858.</li>
            </ul>
            <p style={{ marginBottom: 0, color: 'var(--muted)' }}>
              If you are outside these countries, your national regulator&rsquo;s website lists an
              equivalent service.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
