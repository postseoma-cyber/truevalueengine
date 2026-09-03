import { urlset } from '@/lib/sitemap';
import { competitionUrls } from '@/lib/sitemapdata';

export const revalidate = 3600;

export function GET() {
  return urlset(competitionUrls());
}
