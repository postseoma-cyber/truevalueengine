import { sitemapindex } from '@/lib/sitemap';

export const revalidate = 3600;

export function GET() {
  // T1 and T2 are split so that indexed-vs-submitted is readable per tier in
  // Search Console — which is the metric the migration plan says to watch.
  return sitemapindex(['core', 'competitions', 'margins', 'matchups-t1', 'matchups-t2']);
}
