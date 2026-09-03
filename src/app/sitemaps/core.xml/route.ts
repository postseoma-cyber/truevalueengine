import { urlset } from '@/lib/sitemap';
import { coreUrls } from '@/lib/sitemapdata';

export const revalidate = 3600;

export function GET() {
  return urlset(coreUrls());
}
