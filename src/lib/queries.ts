import { q, q1 } from './db';

/* ------------------------------------------------------------------ *
 * Every SQL statement the site runs lives here, so the contract with  *
 * the engine is reviewable in one file. Nothing below computes a      *
 * probability, a margin or an edge: those are the engine's job and    *
 * are read as stored.                                                 *
 * ------------------------------------------------------------------ */

export type FixtureRow = {
  event_id: string;
  competition_id: number;
  commence_time: string;
  home_team: string;
  away_team: string;
  completed: boolean;
  home_score: number | null;
  away_score: number | null;
  outcome: string | null;
};

/** Scheduled and recently played fixtures for a competition. */
export function competitionFixtures(competitionId: number, fromDays = 90, toDays = 30) {
  return q<FixtureRow>(
    `select event_id, competition_id, commence_time, home_team, away_team,
            completed, home_score, away_score, outcome
       from event_result
      where competition_id = $1
        and commence_time between now() - ($2 || ' days')::interval
                              and now() + ($3 || ' days')::interval
      order by commence_time`,
    [competitionId, fromDays, toDays],
  );
}

/**
 * Every meeting of one ordered pair, newest first. The URL is dateless, so the
 * page shows the next scheduled meeting if there is one and the most recent
 * result otherwise — but it needs the whole history to do that and to draw the
 * head-to-head.
 */
export function pairHistory(competitionId: number, homeTeam: string, awayTeam: string) {
  return q<FixtureRow>(
    `select event_id, competition_id, commence_time, home_team, away_team,
            completed, home_score, away_score, outcome
       from event_result
      where competition_id = $1 and home_team = $2 and away_team = $3
      order by commence_time desc`,
    [competitionId, homeTeam, awayTeam],
  );
}

/** Both directions, for the head-to-head module. */
export function headToHead(competitionId: number, a: string, b: string, limit = 10) {
  return q<FixtureRow>(
    `select event_id, competition_id, commence_time, home_team, away_team,
            completed, home_score, away_score, outcome
       from event_result
      where competition_id = $1 and completed
        and ((home_team = $2 and away_team = $3) or (home_team = $3 and away_team = $2))
      order by commence_time desc
      limit $4`,
    [competitionId, a, b, limit],
  );
}

/** The distinct team names a competition has fielded — drives slug resolution. */
export function competitionTeams(competitionId: number) {
  return q<{ team: string }>(
    `select distinct home_team as team from event_result where competition_id = $1
     union
     select distinct away_team from event_result where competition_id = $1
     order by 1`,
    [competitionId],
  );
}

export type PriceRow = {
  event_id: string;
  market: string;
  selection: string;
  model_prob: string | null;
  market_prob: string | null;
  best_price: string | null;
  best_book: string | null;
  book_count: number | null;
  edge: string | null;
  publishable: boolean;
  withheld_reason: string | null;
  computed_at: string;
};

export function pricesFor(eventId: string) {
  return q<PriceRow>(
    `select event_id, market, selection, model_prob, market_prob, best_price,
            best_book, book_count, edge, publishable, withheld_reason, computed_at
       from model_price
      where event_id = $1
      order by market, selection`,
    [eventId],
  );
}

export type BookPrice = {
  bookmaker_key: string;
  outcome_name: string;
  price: string;
  point: string | null;
  last_seen_at: string;
  deep_link: string | null;
};

/**
 * Current price per book per outcome. `odds_snapshot` is a change log: a row is
 * written only when a price differs from the last one stored, and an unchanged
 * price extends last_seen_at. The live price is therefore the row with the
 * greatest first_seen_at for each (book, outcome).
 */
export function bookPrices(eventId: string, market: string) {
  return q<BookPrice>(
    `select distinct on (bookmaker_key, outcome_name, point)
            bookmaker_key, outcome_name, price::text, point::text,
            last_seen_at, deep_link
       from odds_snapshot
      where event_id = $1 and market_key = $2
      order by bookmaker_key, outcome_name, point, first_seen_at desc`,
    [eventId, market],
  );
}

export type BookMargin = {
  bookmaker_key: string;
  margin: string;
  n_outcomes: number;
  captured_at: string;
};

export function fixtureMargins(eventId: string, market = 'h2h') {
  return q<BookMargin>(
    // ORDER BY must name the numeric column, not the ::text output column of
    // the same name — Postgres resolves the output column first and would sort
    // "-0.0016" before "-0.0147" lexicographically.
    `select bookmaker_key, margin::text as margin, n_outcomes, captured_at
       from v_market_margin
      where event_id = $1 and market_key = $2 and margin is not null
      order by v_market_margin.margin asc`,
    [eventId, market],
  );
}

/** League margin table: every book ranked by measured overround. */
export function leagueMargins(competitionId: number, days = 30, market = 'h2h') {
  return q<{ bookmaker_key: string; n: number; margin_median: string; margin_mean: string; last_seen: string }>(
    `select bookmaker_key,
            count(*)::int as n,
            percentile_cont(0.5) within group (order by margin)::numeric(6,4)::text as margin_median,
            avg(margin)::numeric(6,4)::text as margin_mean,
            max(captured_at) as last_seen
       from v_market_margin
      where competition_id = $1
        and market_key = $2
        and margin is not null
        and captured_at > now() - ($3 || ' days')::interval
      group by bookmaker_key
     having count(*) >= 5
      order by percentile_cont(0.5) within group (order by margin) asc`,
    [competitionId, market, days],
  );
}

/** Publishable selections with a positive edge, for /today/ and /this-week/. */
export function valueSelections(withinHours: number, limit = 200) {
  return q<PriceRow & { commence_time: string; home_team: string; away_team: string; competition_id: number }>(
    `select p.event_id, p.market, p.selection, p.model_prob, p.market_prob,
            p.best_price, p.best_book, p.book_count, p.edge, p.publishable,
            p.withheld_reason, p.computed_at,
            e.commence_time, e.home_team, e.away_team, e.competition_id
       from model_price p
       join event_result e on e.event_id = p.event_id
      where p.publishable
        and p.edge > 0
        and e.commence_time between now() and now() + ($1 || ' hours')::interval
      order by e.commence_time, p.edge desc
      limit $2`,
    [withinHours, limit],
  );
}

/** Fixtures with kick-off inside a window, whether or not they are priced. */
export function upcomingFixtures(withinHours: number, limit = 400) {
  return q<FixtureRow>(
    `select event_id, competition_id, commence_time, home_team, away_team,
            completed, home_score, away_score, outcome
       from event_result
      where commence_time between now() - interval '3 hours'
                              and now() + ($1 || ' hours')::interval
      order by commence_time
      limit $2`,
    [withinHours, limit],
  );
}

/* --------------------------- the record --------------------------- */

export type RecordRow = {
  bucket: string;
  n: number;
  won: number;
  units: string;
  roi: string;
};

/**
 * The settled record. prediction_log holds ONE ROW PER PRICED OUTCOME, not one
 * per recommendation, so a bet is a row with edge > 0. Reporting the two
 * together is how a meaningless "-18.2% ROI" was once produced; the site never
 * shows the combined figure.
 */
export function settledRecord() {
  return q<RecordRow>(
    `select case when publishable then 'Published' else 'Withheld' end as bucket,
            count(*)::int as n,
            count(*) filter (where won)::int as won,
            round(sum(pnl)::numeric, 2)::text as units,
            round((100 * sum(pnl) / nullif(count(*), 0))::numeric, 1)::text as roi
       from prediction_log
      where settled and pnl is not null and edge > 0
      group by 1
      order by 1`,
  );
}

export function settledBySide() {
  return q<RecordRow & { selection: string }>(
    `select selection,
            case when publishable then 'Published' else 'Withheld' end as bucket,
            count(*)::int as n,
            count(*) filter (where won)::int as won,
            round(sum(pnl)::numeric, 2)::text as units,
            round((100 * sum(pnl) / nullif(count(*), 0))::numeric, 1)::text as roi
       from prediction_log
      where settled and pnl is not null and edge > 0 and publishable
      group by 1, 2
      order by n desc`,
  );
}

export function recentSettled(limit = 100) {
  return q<{
    logged_on: string; event_id: string; market: string; selection: string;
    model_prob: string; best_price: string; best_book: string; edge: string;
    won: boolean; pnl: string; commence_time: string;
  }>(
    `select logged_on, event_id, market, selection, model_prob::text,
            best_price::text, best_book, edge::text, won, pnl::text, commence_time
       from prediction_log
      where settled and pnl is not null and edge > 0 and publishable
      order by commence_time desc
      limit $1`,
    [limit],
  );
}

export function openSelections(limit = 100) {
  return q<{
    logged_on: string; event_id: string; market: string; selection: string;
    model_prob: string; best_price: string; best_book: string; edge: string;
    commence_time: string;
  }>(
    `select logged_on, event_id, market, selection, model_prob::text,
            best_price::text, best_book, edge::text, commence_time
       from prediction_log
      where not settled and edge > 0 and publishable and commence_time > now()
      order by commence_time
      limit $1`,
    [limit],
  );
}

/* --------------------------- freshness ---------------------------- */

export async function dataAsOf() {
  const row = await q1<{ odds: string | null; prices: string | null; results: string | null }>(
    `select (select max(last_seen_at) from odds_snapshot)   as odds,
            (select max(computed_at)   from model_price)    as prices,
            (select max(last_seen_at)  from event_result)   as results`,
  );
  return row;
}

export async function bookCount() {
  const row = await q1<{ n: number }>(
    `select count(distinct bookmaker_key)::int as n from odds_snapshot
      where last_seen_at > now() - interval '7 days'`,
  );
  return row?.n ?? 0;
}

/* ------------------- API-Sports fixtures (deep history) ------------------- */

export type AsFixtureRow = {
  as_fixture_id: string;
  competition_id: number;
  season: number | null;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
};

/** Every team name API-Sports has recorded in this competition. */
export function asCompetitionTeams(competitionId: number) {
  return q<{ team: string }>(
    `select distinct home_team as team from as_fixture where competition_id = $1
     union
     select distinct away_team from as_fixture where competition_id = $1
     order by 1`,
    [competitionId],
  );
}

export function asPairHistory(competitionId: number, a: string, b: string, limit = 12) {
  return q<AsFixtureRow>(
    `select as_fixture_id::text, competition_id, season, commence_time, completed,
            home_team, away_team, home_score, away_score, venue
       from as_fixture
      where competition_id = $1
        and ((home_team = $2 and away_team = $3) or (home_team = $3 and away_team = $2))
      order by commence_time desc
      limit $4`,
    [competitionId, a, b, limit],
  );
}

/** Recent form: the last N completed fixtures for one team. */
export function asTeamForm(competitionId: number, team: string, limit = 6) {
  return q<AsFixtureRow>(
    `select as_fixture_id::text, competition_id, season, commence_time, completed,
            home_team, away_team, home_score, away_score, venue
       from as_fixture
      where competition_id = $1 and completed
        and (home_team = $2 or away_team = $2)
      order by commence_time desc
      limit $3`,
    [competitionId, team, limit],
  );
}

/** Match statistics for one fixture, both sides, wide-ish. */
export function asFixtureStats(asSport: string, asFixtureId: string) {
  return q<{ team_side: string; stat_key: string; stat_num: string | null; stat_txt: string | null }>(
    `select team_side, stat_key, stat_num::text, stat_txt
       from as_fixture_stat
      where as_sport = $1 and as_fixture_id = $2`,
    [asSport, asFixtureId],
  );
}

/** Competitions that actually have priced fixtures right now. */
export function pricedCompetitions() {
  return q<{ competition_id: number; n: number; next_kickoff: string }>(
    `select e.competition_id, count(distinct e.event_id)::int as n,
            min(e.commence_time) as next_kickoff
       from event_result e
       join model_price p on p.event_id = e.event_id
      where e.commence_time > now()
      group by 1
      order by 1`,
  );
}

/**
 * Fixtures for one ordered pair, matching on any alias either feed uses for the
 * two clubs. Ordered so the caller can take the next scheduled meeting or, if
 * there is none, the most recent result.
 */
export function findPairFixtures(competitionId: number, homeNames: string[], awayNames: string[]) {
  return q<FixtureRow>(
    `select event_id, competition_id, commence_time, home_team, away_team,
            completed, home_score, away_score, outcome
       from event_result
      where competition_id = $1
        and home_team = any($2::text[])
        and away_team = any($3::text[])
      order by commence_time desc`,
    [competitionId, homeNames, awayNames],
  );
}

export function asFindPairFixtures(competitionId: number, homeNames: string[], awayNames: string[]) {
  return q<AsFixtureRow>(
    `select as_fixture_id::text, competition_id, season, commence_time, completed,
            home_team, away_team, home_score, away_score, venue
       from as_fixture
      where competition_id = $1
        and home_team = any($2::text[])
        and away_team = any($3::text[])
      order by commence_time desc`,
    [competitionId, homeNames, awayNames],
  );
}

/** Both directions, for head-to-head, using every known alias. */
export function asFindMeetings(competitionId: number, aNames: string[], bNames: string[], limit = 12) {
  return q<AsFixtureRow>(
    `select as_fixture_id::text, competition_id, season, commence_time, completed,
            home_team, away_team, home_score, away_score, venue
       from as_fixture
      where competition_id = $1 and completed
        and ((home_team = any($2::text[]) and away_team = any($3::text[]))
          or (home_team = any($3::text[]) and away_team = any($2::text[])))
      order by commence_time desc
      limit $4`,
    [competitionId, aNames, bNames, limit],
  );
}

export function asTeamFormAny(competitionId: number, names: string[], limit = 6) {
  return q<AsFixtureRow>(
    `select as_fixture_id::text, competition_id, season, commence_time, completed,
            home_team, away_team, home_score, away_score, venue
       from as_fixture
      where competition_id = $1 and completed
        and (home_team = any($2::text[]) or away_team = any($2::text[]))
      order by commence_time desc
      limit $3`,
    [competitionId, names, limit],
  );
}

/**
 * The pinned team-name -> URL slug map. The legacy engine slugified whatever the
 * Odds API called a club at the time, and those names have drifted since
 * ("Dundee" is now "Dundee FC", Atlanta United appears as "atlanta-utd"), so no
 * rule reproduces the published URLs. `tve.team_slug` records the mapping;
 * `/opt/tve/build_team_slugs.py` rebuilds it from the live site.
 */
export function teamSlugs(competitionId: number) {
  return q<{ slug: string; team_name: string; source: string }>(
    `select slug, team_name, source from team_slug where competition_id = $1`,
    [competitionId],
  );
}

/**
 * Operators that are not plain sportsbooks. An exchange quotes a price GROSS of
 * commission, so it is not the same kind of number as a bookmaker's price: the
 * engine nets off the operator's published standard rate before choosing a best
 * price, and excludes exchanges that publish no rate (price.py). The table of
 * every book lists quotes as published, which is why a gross exchange price can
 * look better than the one we name best. This map is what lets the page say so
 * rather than appear to contradict itself.
 */
export function operatorModels() {
  return q<{ bookmaker_key: string; model: string; commission_rate: string | null }>(
    `select odds_api_bookmaker_key as bookmaker_key,
            model::text as model,
            commission_rate::text as commission_rate
       from operation
      where odds_api_bookmaker_key is not null and model <> 'sportsbook'`,
  );
}
