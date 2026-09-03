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
    <header style={{ background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
      <div
        className="shell"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 24, minHeight: 64, flexWrap: 'wrap', paddingTop: 10, paddingBottom: 10,
        }}
      >
        <Link href="/" aria-label="True Value Engine" style={{ display: 'flex', alignItems: 'center' }}>
          {/* The site's own mark, white-on-gold, straight off the live site --
              not a redraw. It is already the right colours for this palette. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a plain
              <img> keeps the standalone build free of the sharp dependency the
              image optimiser needs, for one 25KB asset that never resizes. */}
          <img src="/tve-logo.png" alt="True Value Engine" width={1625} height={316}
               style={{ width: 208, height: 'auto', display: 'block' }} />
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, flexWrap: 'wrap' }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} style={{ color: 'var(--body)' }}>
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
    <footer style={{ marginTop: 48, background: '#0E0C09', borderTop: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12 }}>
      <div className="shell" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 8 }}>The engine</div>
            <FLink href="/how-the-engine-works/">How the engine works</FLink>
            <FLink href="/model/accuracy/">Model accuracy</FLink>
            <FLink href="/model/record/">Published record</FLink>
            <FLink href="/margins/">Bookmaker margins</FLink>
          </div>
          <div>
            <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 8 }}>Football</div>
            <FLink href="/today/">Today</FLink>
            <FLink href="/this-week/">This week</FLink>
            <FLink href="/country/">All countries</FLink>
          </div>
          <div style={{ maxWidth: 380 }}>
            <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 8 }}>Countries</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {COUNTRIES.map((c) => (
                <Link key={c.slug} href={`/${c.slug}/`} style={{ color: 'var(--muted)' }}>
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, lineHeight: 1.7 }}>
          <div>
            Odds change constantly. Always confirm the price at the bookmaker before betting.
            18+ — <Link href="/responsible-gambling/" style={{ color: 'var(--accent)' }}>gamble responsibly</Link>.
          </div>
          {asOf ? <div className="m">Prices last checked {asOf}.</div> : null}
          <div style={{ marginTop: 8 }}>
            <Link href="/privacy/" style={{ color: 'var(--muted)' }}>Privacy</Link>
            <span style={{ margin: '0 8px', color: 'var(--rule)' }}>·</span>
            <Link href="/terms/" style={{ color: 'var(--muted)' }}>Terms</Link>
            <span style={{ margin: '0 8px', color: 'var(--rule)' }}>·</span>
            <Link href="/responsible-gambling/" style={{ color: 'var(--muted)' }}>Responsible gambling</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <Link href={href} style={{ color: 'var(--muted)' }}>{children}</Link>
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
