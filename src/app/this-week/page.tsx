import type { Metadata } from 'next';
import { valueSelections, upcomingFixtures } from '@/lib/queries';
import { Card } from '@/components/Modules';
import { withHref } from '@/lib/resolve';
import { ValueList } from '@/components/ValueList';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "This Week's Value Bets — Seven Days of Priced Selections",
  description:
    'Every selection our model rates above the market over the next seven days, with the best bookmaker price and the edge on each.',
  alternates: { canonical: '/this-week/' },
};

export default async function ThisWeekPage() {
  const [raw, fixtures] = await Promise.all([valueSelections(24 * 7, 400), upcomingFixtures(24 * 7, 1000)]);
  const rows = await withHref(raw);
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'This week' }]} />
      <header style={{ padding: '14px 0 20px' }}>
        <h1>This week&rsquo;s value selections</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 760 }}>
          Seven days ahead. {fixtures.length} fixtures priced, {rows.length} selections where the model
          disagrees with the best available price in our favour.
        </p>
      </header>
      <Card title="Selections" sub="Sorted by kick-off, then by edge">
        <ValueList rows={rows} />
      </Card>
    </div>
  );
}
