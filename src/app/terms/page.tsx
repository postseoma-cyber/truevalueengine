import type { Metadata } from 'next';
import { Card } from '@/components/Modules';
import { Breadcrumb } from '@/components/Chrome';

export const revalidate = 86400;
export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'What this site is, what it is not, and the limits of the numbers on it.',
  alternates: { canonical: '/terms/' },
};

export default function Terms() {
  return (
    <div className="shell" style={{ paddingBottom: 48 }}>
      <Breadcrumb trail={[{ href: '/', label: 'Football' }, { label: 'Terms' }]} />
      <header style={{ padding: '14px 0 20px' }}><h1>Terms of use</h1></header>
      <Card title="The short version">
        <div style={{ padding: '18px 24px 22px', maxWidth: 780 }}>
          <p style={{ marginTop: 0 }}>
            This site publishes measurements: bookmaker prices as we recorded them, the margin implied
            by those prices, and the output of a statistical model. It is information, not advice, and
            not a prediction you should rely on.
          </p>
          <p>
            Prices move constantly and ours are checked twice a day. The price shown here may not be
            available when you reach the bookmaker; always confirm before betting.
          </p>
          <p>
            You must be of legal gambling age in your jurisdiction — 18 in most, 21 in parts of the
            United States — and betting must be legal where you are.
          </p>
          <p style={{ marginBottom: 0 }}>
            We make no warranty that any figure is free of error. Where we find one, we correct it and
            say so rather than quietly editing it away.
          </p>
        </div>
      </Card>
    </div>
  );
}
