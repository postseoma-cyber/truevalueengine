import type { Metadata } from 'next';
import Link from 'next/link';
import { COUNTRIES, leaguesByCountry } from '@/lib/leagues';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Football by Country — Every League We Price',
  description: 'The competitions True Value Engine covers, by country, with the best bookmaker price on every fixture.',
  alternates: { canonical: '/country/' },
};

export default function CountryIndex() {
  const byCountry = leaguesByCountry();
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Countries' }]} />
      <header style={{ padding: '14px 0 20px' }}>
        <h1>Browse by country</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 720 }}>
          {COUNTRIES.length} countries, {[...byCountry.values()].flat().length} competitions. Cup and
          continental competitions are out of scope for now: a tie between clubs from different
          pyramids needs a cross-league strength estimate our fixture history cannot support.
        </p>
      </header>
      <Card title="Competitions">
        <div style={{ padding: '18px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 20 }}>
          {COUNTRIES.map((c) => (
            <div key={c.slug}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                <Link href={`/${c.slug}/`}>{c.name}</Link>
              </div>
              {(byCountry.get(c.slug) ?? []).map((l) => (
                <div key={l.league} style={{ marginBottom: 3 }}>
                  <Link href={`/${l.country}/${l.league}/`} style={{ color: 'var(--body)', fontSize: 13 }}>
                    {l.leagueName}
                  </Link>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
