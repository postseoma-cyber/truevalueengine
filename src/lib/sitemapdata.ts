import { type Url } from './sitemap';
import { LEAGUES, COUNTRIES } from './leagues';
import { teamIndex, matchupHref } from './resolve';
import { competitionFixtures } from './queries';
import { isoDay } from './fmt';

export function coreUrls(): Url[] {
  return [
    { loc: '/', changefreq: 'hourly', priority: 1 },
    { loc: '/today/', changefreq: 'hourly', priority: 0.9 },
    { loc: '/this-week/', changefreq: 'daily', priority: 0.8 },
    { loc: '/country/', changefreq: 'weekly', priority: 0.6 },
    { loc: '/margins/', changefreq: 'daily', priority: 0.8 },
    { loc: '/model/accuracy/', changefreq: 'weekly', priority: 0.7 },
    { loc: '/model/record/', changefreq: 'daily', priority: 0.7 },
    { loc: '/how-the-engine-works/', changefreq: 'monthly', priority: 0.5 },
    { loc: '/responsible-gambling/', changefreq: 'yearly', priority: 0.3 },
    { loc: '/privacy/', changefreq: 'yearly', priority: 0.2 },
    { loc: '/terms/', changefreq: 'yearly', priority: 0.2 },
  ];
}

export function competitionUrls(): Url[] {
  return [
    ...COUNTRIES.map((c) => ({ loc: `/${c.slug}/`, changefreq: 'daily', priority: 0.6 })),
    ...LEAGUES.map((l) => ({ loc: `/${l.country}/${l.league}/`, changefreq: 'daily', priority: 0.7 })),
  ];
}

export function marginUrls(): Url[] {
  return LEAGUES.map((l) => ({ loc: `/margins/${l.league}/`, changefreq: 'daily', priority: 0.6 }));
}

/**
 * T1 is the next 10 days and regenerates every ingest run; T2 is everything else
 * inside 90 days either side. T3 (historic) and T4 (never played) never appear
 * in a sitemap at all.
 */
export async function matchupUrls(tier: 1 | 2): Promise<Url[]> {
  const now = Date.now();
  const lists = await Promise.all(
    LEAGUES.map(async (l) => ({
      rows: await competitionFixtures(l.competitionId, tier === 1 ? 0 : 90, tier === 1 ? 10 : 90),
      idx: await teamIndex(l.competitionId),
    })),
  );
  const out: Url[] = [];
  lists.forEach(({ rows, idx }, i) => {
    const l = LEAGUES[i];
    for (const f of rows) {
      const daysAhead = (+new Date(f.commence_time) - now) / 86_400_000;
      if (tier === 1) {
        if (daysAhead < -0.2 || daysAhead > 10) continue;
      } else if (daysAhead > 0 && daysAhead <= 10) {
        continue; // already in the T1 sitemap
      }
      out.push({
        loc: matchupHref(idx, l.country, l.league, f.home_team, f.away_team),
        lastmod: isoDay(f.commence_time),
        changefreq: tier === 1 ? 'hourly' : 'weekly',
        priority: tier === 1 ? 0.8 : 0.5,
      });
    }
  });
  const seen = new Set<string>();
  return out.filter((u) => (seen.has(u.loc) ? false : (seen.add(u.loc), true))).slice(0, 25_000);
}
