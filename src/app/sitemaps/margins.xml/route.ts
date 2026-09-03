import { urlset } from '@/lib/sitemap';
import { marginUrls } from '@/lib/sitemapdata';

export const revalidate = 3600;

export function GET() {
  return urlset(marginUrls());
}
