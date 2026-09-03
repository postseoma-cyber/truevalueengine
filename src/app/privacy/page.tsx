import type { Metadata } from 'next';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;
export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What this site stores, which is almost nothing.',
  alternates: { canonical: '/privacy/' },
};

export default function Privacy() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Privacy' }]} />
      <header style={{ padding: '14px 0 20px' }}><h1>Privacy</h1></header>
      <Card title="What we store">
        <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
          <p style={{ marginTop: 0 }}>
            There is no account, no login and no newsletter, so we hold no personal data about you.
          </p>
          <p>
            Your chosen odds format is kept in your own browser&rsquo;s local storage. It never leaves
            your device and we cannot read it.
          </p>
          <p style={{ marginBottom: 0 }}>
            Server logs record requests for a short period for security and debugging. If we later add
            analytics or affiliate links, this page will say so before it happens, and will name what
            is collected.
          </p>
        </div>
      </Card>
    </div>
  );
}
