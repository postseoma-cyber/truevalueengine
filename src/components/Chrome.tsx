import Link from 'next/link';
import { COUNTRIES } from '@/lib/leagues';

const NAV = [
  { href: '/today/', label: 'Today' },
  { href: '/this-week/', label: 'This week' },
  { href: '/margins/', label: 'Bookmaker margins' },
  { href: '/model/accuracy/', label: 'Model accuracy' },
  { href: '/model/record/', label: 'Record' },
];

export function Header() {
  return (
    <header style={{ background: '#0f172a', borderBottom: '3px solid var(--accent)' }}>
      <div
        className="shell"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 24, minHeight: 64, flexWrap: 'wrap', paddingTop: 10, paddingBottom: 10,
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 26, height: 26, borderRadius: 5, background: 'var(--accent)', display: 'block' }} />
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.06em', color: '#fff' }}>
            TRUE VALUE <span style={{ color: 'var(--accent)' }}>ENGINE</span>
          </span>
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, flexWrap: 'wrap' }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} style={{ color: '#cbd5e1' }}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ asOf }: { asOf?: string }) {
  return (
    <footer style={{ marginTop: 48, background: '#0f172a', color: '#94a3b8', fontSize: 12 }}>
      <div className="shell" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 8 }}>The engine</div>
            <FLink href="/how-the-engine-works/">How the engine works</FLink>
            <FLink href="/model/accuracy/">Model accuracy</FLink>
            <FLink href="/model/record/">Published record</FLink>
            <FLink href="/margins/">Bookmaker margins</FLink>
          </div>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 8 }}>Football</div>
            <FLink href="/today/">Today</FLink>
            <FLink href="/this-week/">This week</FLink>
            <FLink href="/country/">All countries</FLink>
          </div>
          <div style={{ maxWidth: 380 }}>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 8 }}>Countries</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {COUNTRIES.map((c) => (
                <Link key={c.slug} href={`/${c.slug}/`} style={{ color: '#94a3b8' }}>
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 16, lineHeight: 1.7 }}>
          <div>
            Odds change constantly. Always confirm the price at the bookmaker before betting.
            18+ — <Link href="/responsible-gambling/" style={{ color: '#cbd5e1' }}>gamble responsibly</Link>.
          </div>
          {asOf ? <div className="m">Prices last checked {asOf}.</div> : null}
          <div style={{ marginTop: 8 }}>
            <Link href="/privacy/" style={{ color: '#94a3b8' }}>Privacy</Link>
            <span style={{ margin: '0 8px', color: '#334155' }}>·</span>
            <Link href="/terms/" style={{ color: '#94a3b8' }}>Terms</Link>
            <span style={{ margin: '0 8px', color: '#334155' }}>·</span>
            <Link href="/responsible-gambling/" style={{ color: '#94a3b8' }}>Responsible gambling</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <Link href={href} style={{ color: '#94a3b8' }}>{children}</Link>
    </div>
  );
}

export function Breadcrumb({ trail }: { trail: { href?: string; label: string }[] }) {
  return (
    <nav className="crumb" aria-label="Breadcrumb">
      {trail.map((t, i) => (
        <span key={i}>
          {i > 0 ? <span className="sep">›</span> : null}
          {t.href ? <Link href={t.href} style={{ color: 'var(--muted)' }}>{t.label}</Link> : <span style={{ color: 'var(--body)' }}>{t.label}</span>}
        </span>
      ))}
    </nav>
  );
}
