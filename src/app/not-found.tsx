import Link from 'next/link';
import { Card } from '@/components/Modules';

export default function NotFound() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <header style={{ padding: '32px 0 20px', maxWidth: 720 }}>
        <h1>This page has nothing behind it</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          Most likely these two clubs have never been drawn against each other in this competition, so
          there is no fixture, no price and nothing honest to show. We do not publish a page for a
          match that has not happened.
        </p>
      </header>
      <Card title="Try instead">
        <div style={{ padding: '18px 24px 22px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Link href="/today/">Today&rsquo;s selections</Link>
          <Link href="/this-week/">This week</Link>
          <Link href="/country/">All competitions</Link>
          <Link href="/margins/">Bookmaker margins</Link>
        </div>
      </Card>
    </div>
  );
}
