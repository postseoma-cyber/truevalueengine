import { urlset } from '@/lib/sitemap';
import { matchupUrls } from '@/lib/sitemapdata';

export const revalidate = 3600;

export async function GET() {
  return urlset(await matchupUrls(2));
}
