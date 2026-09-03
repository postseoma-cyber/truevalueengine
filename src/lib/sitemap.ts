export type Url = { loc: string; lastmod?: string; changefreq?: string; priority?: number };

const SITE = () => process.env.SITE_URL ?? 'https://www.truevalueengine.com';

export function urlset(urls: Url[]): Response {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => {
        const parts = [`    <loc>${esc(SITE() + u.loc)}</loc>`];
        if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
        if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
        if (u.priority != null) parts.push(`    <priority>${u.priority.toFixed(1)}</priority>`);
        return `  <url>\n${parts.join('\n')}\n  </url>`;
      })
      .join('\n') +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800' },
  });
}

export function sitemapindex(names: string[]): Response {
  const now = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    names
      .map((n) => `  <sitemap>\n    <loc>${esc(SITE() + '/sitemaps/' + n + '.xml')}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`)
      .join('\n') +
    `\n</sitemapindex>\n`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800' },
  });
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
