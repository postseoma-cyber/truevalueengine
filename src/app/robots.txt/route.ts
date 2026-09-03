// Dynamic, not static. robots.txt is the one file whose answer depends on
// WHICH HOST is serving it, and a prerendered one is baked at build time from
// whatever env the builder happened to have. That is how a staging image ships
// "Allow: /": correct for production, an invitation to index the staging copy.
// The file is three lines and touches no database, so reading env per request
// costs nothing and lets one image be deployed to both.
export const dynamic = 'force-dynamic';

export function GET() {
  const site = process.env.SITE_URL ?? 'https://www.truevalueengine.com';
  const staging = process.env.TVE_STAGING === '1';
  const body = staging
    ? `User-agent: *\nDisallow: /\n`
    : [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        '',
        `Sitemap: ${site}/sitemap.xml`,
        '',
      ].join('\n');
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
