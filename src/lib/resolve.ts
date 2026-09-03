import { cache } from 'react';
import { BY_PATH, BY_ID, type League } from './leagues';
import { slugify } from './slug';
import { asCompetitionTeams, competitionTeams, teamSlugs } from './queries';

export type TeamIndex = {
  /** slug -> the name the odds feed uses, which is what we display */
  bySlug: Map<string, string>;
  /** every name we know, so history lookups can match either source */
  aliases: Map<string, string[]>;
  /** name -> slug. Every link the site emits must be built from this, or the
   *  URL we publish will not be the URL the page resolves. */
  slugByName: Map<string, string>;
};

/**
 * Team names arrive from two feeds that do not agree: the Odds API (which the
 * legacy URLs were slugified from, and which model_price is keyed to) and
 * API-Sports (which carries the deep fixture history). Both are indexed by the
 * same slug so a URL resolves whichever source holds the fixture.
 */
export const teamIndex = cache(async (competitionId: number): Promise<TeamIndex> => {
  const [odds, as_, pinned] = await Promise.all([
    competitionTeams(competitionId),
    asCompetitionTeams(competitionId),
    teamSlugs(competitionId).catch(() => []),
  ]);
  const bySlug = new Map<string, string>();
  const aliases = new Map<string, string[]>();
  const slugByName = new Map<string, string>();
  const add = (name: string, preferred: boolean) => {
    const s = slugify(name);
    if (!s) return;
    if (preferred || !bySlug.has(s)) bySlug.set(s, name);
    const list = aliases.get(s) ?? [];
    if (!list.includes(name)) list.push(name);
    aliases.set(s, list);
    if (preferred || !slugByName.has(name)) slugByName.set(name, s);
  };
  for (const r of as_) add(r.team, false);
  for (const r of odds) add(r.team, true); // the odds feed name wins for display

  // Pinned slugs win over anything the rule generates: they are the URLs the
  // live site already publishes, and breaking one costs whatever authority it
  // has. A pinned slug also carries its alias list forward, so a fixture stored
  // under either feed's spelling still resolves.
  for (const p of pinned) {
    const existing = aliases.get(p.slug) ?? [];
    if (!existing.includes(p.team_name)) existing.push(p.team_name);
    aliases.set(p.slug, existing);
    bySlug.set(p.slug, p.team_name);
    slugByName.set(p.team_name, p.slug);
  }
  return { bySlug, aliases, slugByName };
});

export function leagueFromPath(country: string, league: string): League | null {
  return BY_PATH.get(`${country}/${league}`) ?? null;
}

/**
 * The href for a fixture. Link generation and URL resolution must use the same
 * map, or the site publishes links to pages that 404.
 */
export function matchupHref(
  idx: TeamIndex,
  country: string,
  league: string,
  home: string,
  away: string,
): string {
  const h = idx.slugByName.get(home) ?? slugify(home);
  const a = idx.slugByName.get(away) ?? slugify(away);
  return `/${country}/${league}/${h}-vs-${a}/`;
}

/**
 * Attach a link to rows that span competitions. Each competition's slug map is
 * loaded once per request (React `cache`), so a 400-row list costs one query
 * per competition, not one per row.
 */
export async function withHref<T extends { competition_id: number; home_team: string; away_team: string }>(
  rows: T[],
): Promise<(T & { href: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.competition_id))];
  const idx = new Map(await Promise.all(ids.map(async (id) => [id, await teamIndex(id)] as const)));
  return rows.map((r) => {
    const l = BY_ID.get(r.competition_id);
    const i = idx.get(r.competition_id);
    return {
      ...r,
      href: l && i ? matchupHref(i, l.country, l.league, r.home_team, r.away_team) : null,
    };
  });
}
