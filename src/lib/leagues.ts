// The competition -> URL mapping.
//
// The live site's country and league slugs were minted by the legacy PHP engine
// and are not derivable from anything in the database: `competition.title` holds
// Odds API titles ("EPL", "La Liga - Spain") and `country_iso2` is empty for
// every row. Those URLs carry whatever authority the site has, so the mapping is
// reproduced here verbatim rather than regenerated.
//
// `legacy: true` means the URL already exists on truevalueengine.com and must
// not change. The rest are new competitions that the legacy engine never
// covered; their slugs follow the same {country}-{league} convention.

export type League = {
  competitionId: number;
  country: string;      // URL segment 1
  countryName: string;
  league: string;       // URL segment 2
  leagueName: string;   // how we name it in prose
  shortName: string;    // for tight table cells
  legacy: boolean;
};

export const LEAGUES: League[] = [
  { competitionId: 21, country: 'argentina', countryName: 'Argentina', league: 'argentina-primera-division', leagueName: 'Argentine Primera División', shortName: 'Primera División', legacy: true },
  { competitionId: 22, country: 'australia', countryName: 'Australia', league: 'australia-a-league', leagueName: 'A-League Men', shortName: 'A-League', legacy: false },
  { competitionId: 23, country: 'austria', countryName: 'Austria', league: 'austria-bundesliga', leagueName: 'Austrian Bundesliga', shortName: 'Bundesliga', legacy: true },
  { competitionId: 24, country: 'belgium', countryName: 'Belgium', league: 'belgium-jupiler-league', leagueName: 'Belgian Pro League', shortName: 'Pro League', legacy: true },
  { competitionId: 25, country: 'brazil', countryName: 'Brazil', league: 'brazil-serie-a', leagueName: 'Brasileirão Série A', shortName: 'Série A', legacy: true },
  { competitionId: 26, country: 'brazil', countryName: 'Brazil', league: 'brazil-serie-b', leagueName: 'Brasileirão Série B', shortName: 'Série B', legacy: false },
  { competitionId: 27, country: 'chile', countryName: 'Chile', league: 'chile-primera-division', leagueName: 'Chilean Primera División', shortName: 'Primera División', legacy: false },
  { competitionId: 28, country: 'china', countryName: 'China', league: 'china-super-league', leagueName: 'Chinese Super League', shortName: 'CSL', legacy: true },
  { competitionId: 34, country: 'denmark', countryName: 'Denmark', league: 'denmark-superliga', leagueName: 'Superliga', shortName: 'Superliga', legacy: true },
  { competitionId: 35, country: 'england', countryName: 'England', league: 'england-championship', leagueName: 'EFL Championship', shortName: 'Championship', legacy: true },
  { competitionId: 37, country: 'england', countryName: 'England', league: 'england-league-1', leagueName: 'EFL League One', shortName: 'League One', legacy: true },
  { competitionId: 38, country: 'england', countryName: 'England', league: 'england-league-2', leagueName: 'EFL League Two', shortName: 'League Two', legacy: true },
  { competitionId: 39, country: 'england', countryName: 'England', league: 'england-premier-league', leagueName: 'Premier League', shortName: 'Premier League', legacy: true },
  { competitionId: 47, country: 'finland', countryName: 'Finland', league: 'finland-veikkausliiga', leagueName: 'Veikkausliiga', shortName: 'Veikkausliiga', legacy: true },
  { competitionId: 49, country: 'france', countryName: 'France', league: 'france-ligue-1', leagueName: 'Ligue 1', shortName: 'Ligue 1', legacy: true },
  { competitionId: 50, country: 'france', countryName: 'France', league: 'france-ligue-2', leagueName: 'Ligue 2', shortName: 'Ligue 2', legacy: true },
  { competitionId: 51, country: 'germany', countryName: 'Germany', league: 'germany-bundesliga', leagueName: 'Bundesliga', shortName: 'Bundesliga', legacy: true },
  { competitionId: 52, country: 'germany', countryName: 'Germany', league: 'germany-bundesliga-2', leagueName: '2. Bundesliga', shortName: '2. Bundesliga', legacy: true },
  { competitionId: 53, country: 'germany', countryName: 'Germany', league: 'germany-frauen-bundesliga', leagueName: 'Frauen-Bundesliga', shortName: 'Frauen-Bundesliga', legacy: false },
  { competitionId: 55, country: 'germany', countryName: 'Germany', league: 'germany-3-liga', leagueName: '3. Liga', shortName: '3. Liga', legacy: false },
  { competitionId: 56, country: 'greece', countryName: 'Greece', league: 'greece-ethniki-katigoria', leagueName: 'Super League Greece', shortName: 'Super League', legacy: true },
  { competitionId: 58, country: 'italy', countryName: 'Italy', league: 'italy-serie-a', leagueName: 'Serie A', shortName: 'Serie A', legacy: true },
  { competitionId: 59, country: 'italy', countryName: 'Italy', league: 'italy-serie-b', leagueName: 'Serie B', shortName: 'Serie B', legacy: true },
  { competitionId: 60, country: 'japan', countryName: 'Japan', league: 'japan-j-league', leagueName: 'J1 League', shortName: 'J1 League', legacy: true },
  { competitionId: 61, country: 'south-korea', countryName: 'South Korea', league: 'south-korea-k-league-1', leagueName: 'K League 1', shortName: 'K League 1', legacy: false },
  { competitionId: 62, country: 'ireland', countryName: 'Ireland', league: 'ireland-premier-division', leagueName: 'League of Ireland Premier Division', shortName: 'LOI Premier', legacy: true },
  { competitionId: 63, country: 'mexico', countryName: 'Mexico', league: 'mexico-liga-mx', leagueName: 'Liga MX', shortName: 'Liga MX', legacy: true },
  { competitionId: 64, country: 'netherlands', countryName: 'Netherlands', league: 'netherlands-eredivisie', leagueName: 'Eredivisie', shortName: 'Eredivisie', legacy: false },
  { competitionId: 65, country: 'norway', countryName: 'Norway', league: 'norway-eliteserien', leagueName: 'Eliteserien', shortName: 'Eliteserien', legacy: true },
  { competitionId: 66, country: 'poland', countryName: 'Poland', league: 'poland-ekstraklasa', leagueName: 'Ekstraklasa', shortName: 'Ekstraklasa', legacy: true },
  { competitionId: 67, country: 'portugal', countryName: 'Portugal', league: 'portugal-liga-i', leagueName: 'Primeira Liga', shortName: 'Primeira Liga', legacy: true },
  { competitionId: 68, country: 'russia', countryName: 'Russia', league: 'russia-premier-league', leagueName: 'Russian Premier League', shortName: 'RPL', legacy: true },
  { competitionId: 69, country: 'saudi-arabia', countryName: 'Saudi Arabia', league: 'saudi-arabia-pro-league', leagueName: 'Saudi Pro League', shortName: 'Pro League', legacy: false },
  { competitionId: 71, country: 'spain', countryName: 'Spain', league: 'spain-la-liga', leagueName: 'LaLiga', shortName: 'LaLiga', legacy: true },
  { competitionId: 72, country: 'spain', countryName: 'Spain', league: 'spain-la-liga-2', leagueName: 'LaLiga 2', shortName: 'LaLiga 2', legacy: true },
  { competitionId: 73, country: 'scotland', countryName: 'Scotland', league: 'scotland-premier-league', leagueName: 'Scottish Premiership', shortName: 'Premiership', legacy: true },
  { competitionId: 74, country: 'sweden', countryName: 'Sweden', league: 'sweden-allsvenskan', leagueName: 'Allsvenskan', shortName: 'Allsvenskan', legacy: true },
  { competitionId: 75, country: 'sweden', countryName: 'Sweden', league: 'sweden-superettan', leagueName: 'Superettan', shortName: 'Superettan', legacy: false },
  { competitionId: 76, country: 'switzerland', countryName: 'Switzerland', league: 'switzerland-super-league', leagueName: 'Swiss Super League', shortName: 'Super League', legacy: true },
  { competitionId: 77, country: 'turkey', countryName: 'Türkiye', league: 'turkey-ligi-1', leagueName: 'Süper Lig', shortName: 'Süper Lig', legacy: true },
  { competitionId: 86, country: 'usa', countryName: 'United States', league: 'usa-mls', leagueName: 'Major League Soccer', shortName: 'MLS', legacy: true },
];

/**
 * Leagues the live site publishes that this build has no data source for. The
 * Odds API carries no feed for them, so there is nothing honest to put on the
 * page. Their whole subtree answers 410 rather than 301: a redirect to a league
 * hub would teach Google that our URLs are unreliable.
 */
export const RETIRED_LEAGUES: ReadonlySet<string> = new Set([
  'england/england-conference',
  'romania/romania-liga-1',
  'scotland/scotland-division-1',
  'scotland/scotland-division-2',
  'scotland/scotland-division-3',
]);

export const BY_ID = new Map(LEAGUES.map((l) => [l.competitionId, l]));
export const BY_PATH = new Map(LEAGUES.map((l) => [`${l.country}/${l.league}`, l]));

export function leaguesByCountry(): Map<string, League[]> {
  const m = new Map<string, League[]>();
  for (const l of LEAGUES) {
    const arr = m.get(l.country) ?? [];
    arr.push(l);
    m.set(l.country, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
  return m;
}

export const COUNTRIES = [...leaguesByCountry().keys()]
  .map((c) => ({ slug: c, name: BY_PATH.get(`${c}/${leaguesByCountry().get(c)![0].league}`)!.countryName }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const TRACKED_COMPETITION_IDS = LEAGUES.map((l) => l.competitionId);
