// URL slugs must reproduce what the live site already publishes, because those
// URLs carry whatever authority the site has. The legacy engine slugified the
// Odds API team name after dropping club-type noise: "Dundee FC" -> "dundee",
// "Falkirk F.C." -> "falkirk", while "St Johnstone" -> "st-johnstone".
//
// The rule below is deliberately conservative: it only removes a club-type
// token when it sits at the END of the name, because a leading token is often
// part of how the club is known ("AC Milan", "FC Copenhagen"). Anything this
// rule gets wrong is corrected by the team_slug override table rather than by
// making the rule cleverer — see /opt/tve/build_team_slugs.py.

const TRAILING_NOISE = /\s+(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|f\.?k\.?)\.?$/i;
const COMBINING_MARKS = /[̀-ͯ]/g;

export function slugify(input: string): string {
  return input
    .replace(TRAILING_NOISE, '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[åÅ]/g, 'a')
    .replace(/[đĐ]/g, 'd')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The dateless ordered pair that identifies a matchup URL. */
export function matchupSlug(home: string, away: string): string {
  return `${slugify(home)}-vs-${slugify(away)}`;
}

/**
 * Split a matchup slug into its two halves. A team name containing "-vs-" would
 * be ambiguous; none does, so the first occurrence is authoritative.
 */
export function splitMatchup(slug: string): { home: string; away: string } | null {
  const i = slug.indexOf('-vs-');
  if (i <= 0) return null;
  const home = slug.slice(0, i);
  const away = slug.slice(i + 4);
  if (!home || !away) return null;
  return { home, away };
}
