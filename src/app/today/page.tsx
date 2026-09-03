import type { Metadata } from 'next';
import { valueSelections, upcomingFixtures } from '@/lib/queries';
import { Card } from '@/components/Modules';
import { withHref } from '@/lib/resolve';
import { ValueList } from '@/components/ValueList';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Today's Value Bets — Every Selection, Priced and Dated",
  description:
    "Every selection our model rates above the market today, with the best bookmaker price and the edge. Published before kick-off, wins and losses alike.",
  alternates: { canonical: '/today/' },
};

export default async function TodayPage() {
  const [raw, fixtures] = await Promise.all([valueSelections(24, 200), upcomingFixtures(24, 400)]);
  const rows = await withHref(raw);
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Today' }]} />
      <header style={{ padding: '14px 0 20px' }}>
        <h1>Today&rsquo;s value selections</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 760 }}>
          Every fixture kicking off in the next 24 hours where the model rates an outcome above the
          best price available. {fixtures.length} fixtures are in the window;{' '}
          {rows.length} selections clear the bar. Nothing here is filtered after the fact — this is the
          list as the engine produced it.
        </p>
      </header>
      <Card title="Selections" sub="Model probability against the margin-free market consensus">
        <ValueList rows={rows} />
      </Card>
    </div>
  );
}
