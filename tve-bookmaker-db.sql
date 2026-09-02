-- TrueValueEngine bookmaker database - full install
-- Generated 2026-09-01. Apply to an empty database:  psql -U postgres -d tve -f tve-bookmaker-db.sql
-- Contains: schema (14 tables, 11 enums) + seed (74 brands, 94 operations)
--           + reference (12 regulators, 39 payment methods, 130 competitions)
--           + derived metrics (margin engine, best-price engine, frontend view)


-- ============================================================
-- 01_schema.sql
-- ============================================================

-- ============================================================================
-- TrueValueEngine — Bookmaker Database
-- Postgres 15+ DDL. Schema: tve
-- Design rules:
--   1. The unit of record is BRAND x GEO MARKET ("operation"), never brand alone.
--      bet365 UK and bet365 NJ are different licences, T&Cs, limits and payouts.
--   2. Every collected fact carries provenance: source_url + captured_at + hash.
--      Without it the DB rots silently.
--   3. No field exists unless it (a) renders on a page, (b) filters a list,
--      or (c) feeds a calculation. Everything else is noise.
--   4. Verbatim quotes are stored alongside parsed values, never instead of.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS tve;
SET search_path TO tve, public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

-- Site GEO folders. Maps 1:N onto The Odds API `regions` parameter.
CREATE TYPE geo_market AS ENUM ('row','us','ca','au','uk');

-- The Odds API regions parameter values (as of Sep 2026).
CREATE TYPE odds_api_region AS ENUM ('us','us2','us_dfs','us_ex','uk','eu','au','ca','fr','se','fi');

CREATE TYPE operator_model AS ENUM (
  'sportsbook',        -- traditional fixed-odds book
  'exchange',          -- Betfair, Smarkets, Matchbook
  'dfs',               -- PrizePicks, Underdog
  'prediction_market'  -- Kalshi, Polymarket, Novig
);

CREATE TYPE licence_verification AS ENUM (
  'verified_against_register', -- number matched in the regulator's public register
  'register_no_match',         -- register exists, number not found  -> RED FLAG
  'no_number_published',       -- regulator named, no number given (typical AU/US)
  'no_public_register'         -- e.g. Anjouan/Mwali -> unverifiable claim
);

CREATE TYPE bonus_type AS ENUM (
  'deposit_match','free_bet','bet_insurance','bonus_bets','risk_free',
  'odds_boost','no_deposit','deposit_bonus_tiered','profit_boost','other'
);

CREATE TYPE wagering_base AS ENUM ('bonus_only','deposit_plus_bonus','deposit_only','none','unstated');

CREATE TYPE txn_direction AS ENUM ('deposit','withdrawal','both');

-- Fees are almost never published as numbers. Model the *state of disclosure*.
CREATE TYPE fee_disclosure AS ENUM (
  'none_charged','charged_amount_stated','charged_amount_unstated','not_mentioned'
);

CREATE TYPE kyc_timing AS ENUM (
  'at_registration','threshold_triggered','at_first_withdrawal','unspecified'
);

CREATE TYPE dormancy_mechanic AS ENUM ('none','periodic_fee','balance_zeroed','account_closed','unstated');

-- The verbatim-clause table covers exactly the clauses a value bettor acts on.
CREATE TYPE clause_type AS ENUM (
  'palpable_error',        -- how obvious odds mistakes are handled
  'arbitrage',             -- "bets on all outcomes" / cross-book arbing ban
  'bonus_abuse',
  'account_limiting',      -- discretionary stake/account restriction language
  'bot_automation',        -- scripts, APIs, AI
  'closed_loop_withdrawal',
  'dormancy',
  'kyc',
  'void_leg_multiples',    -- how a void selection settles inside a parlay
  'void_leg_bet_builder',  -- SGP recalculation vs whole-bet void
  'dead_heat',
  'rule_4',
  'each_way',
  'postponed_abandoned',   -- the 12h / 24h / 48h void window - varies materially
  'max_winnings',
  'complaints_adr',
  'restricted_territories',
  'minimum_bet_limit',     -- AU racing-body MBL obligation
  'best_odds_guaranteed'
);

CREATE TYPE confidence AS ENUM ('verbatim','parsed','inferred','third_party');

CREATE TYPE link_kind AS ENUM ('affiliate','direct','odds_api_deeplink');

-- ---------------------------------------------------------------------------
-- REFERENCE TABLES
-- ---------------------------------------------------------------------------

-- Which Odds API regions feed which site GEO folder.
CREATE TABLE geo_region_map (
  geo            geo_market       NOT NULL,
  api_region     odds_api_region  NOT NULL,
  is_primary     boolean          NOT NULL DEFAULT false,
  PRIMARY KEY (geo, api_region)
);

CREATE TABLE regulator (
  id                 serial PRIMARY KEY,
  code               text UNIQUE NOT NULL,     -- 'ukgc','mga','gib','on_igo','nj_dge','nt_racing','anj_fr','cga_cw','anjouan'
  name               text NOT NULL,
  country_iso2       char(2),
  subdivision        text,                     -- 'ON', 'NJ', 'NT'
  register_url       text,
  register_machine_readable boolean NOT NULL DEFAULT false, -- UKGC ships CSV; MGA is a JS SPA; Curacao is PDFs
  consumer_protection_tier smallint,           -- 1 strong (UKGC/MGA/state) .. 3 none (Anjouan)
  notes              text
);

CREATE TABLE payment_method (
  id            serial PRIMARY KEY,
  code          text UNIQUE NOT NULL,          -- 'visa','paypal','skrill','trustly','apple_pay','btc','interac','poli','payid'
  name          text NOT NULL,
  category      text NOT NULL,                 -- card | ewallet | bank | prepaid | crypto | cash | mobile
  is_crypto     boolean NOT NULL DEFAULT false
);

CREATE TABLE sport (
  id                 serial PRIMARY KEY,
  code               text UNIQUE NOT NULL,     -- 'soccer','tennis','americanfootball','basketball'
  name               text NOT NULL,
  odds_api_group     text                      -- 'Soccer','Tennis','American Football','Basketball'
);

-- One row per Odds API sport key. Tennis keys are PER TOURNAMENT and go inactive
-- between events - the site architecture has to handle that, so it is modelled.
CREATE TABLE competition (
  id                 serial PRIMARY KEY,
  sport_id           int NOT NULL REFERENCES sport(id),
  odds_api_sport_key text UNIQUE NOT NULL,     -- 'soccer_epl', 'tennis_atp_us_open'
  title              text NOT NULL,
  is_tournament_key  boolean NOT NULL DEFAULT false, -- true for tennis: seasonal on/off
  is_outright_key    boolean NOT NULL DEFAULT false, -- '..._championship_winner'
  active_last_seen   timestamptz,
  country_iso2       char(2)
);

-- ---------------------------------------------------------------------------
-- BRAND  ->  OPERATION  (the core split)
-- ---------------------------------------------------------------------------

CREATE TABLE brand (
  id                    serial PRIMARY KEY,
  slug                  text UNIQUE NOT NULL,       -- 'bet365','pinnacle','draftkings'
  name                  text NOT NULL,
  parent_group          text,                       -- 'Flutter Entertainment','Entain','Kindred'
  founded_year          smallint,                   -- incorporation, from a corporate register
  founded_year_claimed  smallint,                   -- the About-page marketing claim, kept separate
  hq_country_iso2       char(2),
  logo_url              text,
  logo_dark_url         text,
  brand_colour_hex      char(7),
  affiliate_programme_name text,                     -- 'bet365 Partners'
  affiliate_programme_url  text,
  website_root          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- THE central table. One row per brand per jurisdiction/market.
CREATE TABLE operation (
  id                        serial PRIMARY KEY,
  brand_id                  int NOT NULL REFERENCES brand(id) ON DELETE CASCADE,
  slug                      text UNIQUE NOT NULL,     -- 'bet365-uk','bet365-nj','pinnacle-row'
  geo                       geo_market NOT NULL,
  market_label              text NOT NULL,            -- 'United Kingdom','New Jersey','Ontario','Rest of World'
  country_iso2              char(2),
  subdivision               text,
  domain                    text NOT NULL,            -- 'bet365.com','sportsbook.draftkings.com'
  model                     operator_model NOT NULL DEFAULT 'sportsbook',

  -- JOIN KEY to the odds feed. NULL = we hold editorial data but no live prices.
  odds_api_bookmaker_key    text,                     -- 'bet365_au','pinnacle','draftkings'
  odds_api_region           odds_api_region,
  in_odds_feed              boolean GENERATED ALWAYS AS (odds_api_bookmaker_key IS NOT NULL) STORED,

  -- Operationally the single most important attribute for a comparison site.
  public_odds_without_login boolean,
  odds_formats_offered      text[],                   -- {decimal,fractional,american,hongkong,malay,indonesian}

  -- Product flags: each one either filters a list or renders a badge.
  has_cash_out              boolean,
  has_partial_cash_out      boolean,
  has_live_cash_out         boolean,
  has_bet_builder           boolean,
  has_live_streaming        boolean,
  has_live_betting          boolean,
  has_best_odds_guaranteed  boolean,
  has_ios_app               boolean,
  has_android_app           boolean,
  ios_app_url               text,
  android_app_url           text,
  ios_rating                numeric(2,1),
  ios_rating_count          int,
  android_rating            numeric(2,1),
  android_rating_count      int,

  -- Money, where it is genuinely published.
  min_deposit_amount        numeric(12,2),
  min_deposit_currency      char(3),
  min_stake_amount          numeric(12,2),            -- often channel-dependent; see min_stake_note
  min_stake_note            text,
  max_stake_published       boolean NOT NULL DEFAULT false, -- true only for Pinnacle-likes
  currencies_supported      char(3)[],

  -- Deliberately NOT modelled as numbers (see docs):
  --   max withdrawal per day/week/month  -> prohibited in GB, unpublished elsewhere
  --   max stake                          -> a discretionary clause, not a number
  --   stated margin                      -> books do not publish it; we compute ours
  --   sharp_friendly                     -> community folklore, not a published fact

  kyc_timing                kyc_timing,
  dormancy_mechanic         dormancy_mechanic,
  dormancy_trigger_days     int,
  dormancy_fee_amount       numeric(12,2),
  dormancy_fee_pct          numeric(5,2),
  dormancy_fee_currency     char(3),

  support_live_chat         boolean,
  support_email             boolean,
  support_phone             boolean,
  support_hours_note        text,

  -- Editorial + commercial
  is_recommended            boolean NOT NULL DEFAULT false,
  editorial_rating          numeric(3,1),             -- 0.0-10.0, our own, labelled as opinion
  review_status             text NOT NULL DEFAULT 'draft', -- draft|published|archived
  status                    text NOT NULL DEFAULT 'active', -- active|closed|suspended

  first_collected_at        timestamptz,
  last_verified_at          timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operation_api_key_region_ck
    CHECK ((odds_api_bookmaker_key IS NULL) = (odds_api_region IS NULL))
);

CREATE UNIQUE INDEX operation_api_key_uq
  ON operation(odds_api_bookmaker_key) WHERE odds_api_bookmaker_key IS NOT NULL;
CREATE INDEX operation_geo_idx      ON operation(geo) WHERE status='active';
CREATE INDEX operation_brand_idx    ON operation(brand_id);

-- ---------------------------------------------------------------------------
-- LICENSING
-- ---------------------------------------------------------------------------

CREATE TABLE operation_licence (
  id                    serial PRIMARY KEY,
  operation_id          int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  regulator_id          int NOT NULL REFERENCES regulator(id),
  licence_number_stated text,                          -- verbatim, nullable by design
  licensee_legal_entity text,                          -- 'Hillside (Gibraltar Sports) LP'
  verification          licence_verification NOT NULL,
  verified_at           timestamptz,
  register_entry_url    text,
  has_sanctions         boolean NOT NULL DEFAULT false, -- UKGC publishes regulatory actions
  sanctions_note        text,
  source_url            text NOT NULL,
  captured_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, regulator_id, licence_number_stated)
);

-- Domains the regulator says the operator may run. Detects clone/mirror sites.
CREATE TABLE operation_authorised_domain (
  operation_id  int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  domain        text NOT NULL,
  source        text NOT NULL,                          -- 'ukgc_register','igo_ontario','operator_site'
  captured_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, domain)
);

-- ---------------------------------------------------------------------------
-- BONUS OFFERS  (versioned - offers churn, history is the asset)
-- ---------------------------------------------------------------------------

CREATE TABLE bonus_offer (
  id                      serial PRIMARY KEY,
  operation_id            int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  headline                text NOT NULL,                -- 'Bet £10 Get £30 in Free Bets'
  type                    bonus_type NOT NULL,
  is_welcome_offer        boolean NOT NULL DEFAULT true,

  currency                char(3),
  max_bonus_amount        numeric(12,2),
  match_pct               numeric(5,2),
  qualifying_stake        numeric(12,2),
  min_deposit_to_qualify  numeric(12,2),

  -- Rollover is frequently published as a RANGE ("10-25x"), not a number.
  wagering_multiplier_min numeric(6,2),
  wagering_multiplier_max numeric(6,2),
  wagering_base           wagering_base NOT NULL DEFAULT 'unstated',
  min_odds_decimal        numeric(6,3),                 -- normalised; store fractional verbatim below
  min_odds_verbatim       text,
  wagering_window_days    int,
  bonus_expiry_days       int,
  excluded_payment_methods int[],                       -- FK-ish to payment_method(id); Skrill/Neteller usually excluded
  excluded_markets_note   text,

  -- Computed by us, not by them. See 06_derived_metrics.sql.
  effective_value_score   numeric(6,3),                 -- expected retained value per unit staked
  effective_value_note    text,

  terms_url               text NOT NULL,
  terms_verbatim          text,                         -- the qualifying paragraph, quoted
  content_hash            text,                         -- detects silent T&C edits
  valid_from              date,
  valid_to                date,
  is_current              boolean NOT NULL DEFAULT true,
  source_gated            boolean NOT NULL DEFAULT false, -- true = terms sit behind login (typical US)
  source_note             text,                           -- where it came from if not primary
  captured_at             timestamptz NOT NULL DEFAULT now(),
  confidence              confidence NOT NULL DEFAULT 'parsed'
);
CREATE INDEX bonus_current_idx ON bonus_offer(operation_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- ---------------------------------------------------------------------------

CREATE TABLE operation_payment (
  id                    serial PRIMARY KEY,
  operation_id          int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  payment_method_id     int NOT NULL REFERENCES payment_method(id),
  direction             txn_direction NOT NULL,
  currency              char(3),
  min_amount            numeric(12,2),
  max_amount            numeric(12,2),                  -- per transaction (published); NOT a periodic cap
  processing_time_text  text,                           -- '1-5 Banking Days','Instant'
  processing_hours_min  int,                            -- parsed for sorting
  processing_hours_max  int,
  fee_disclosure        fee_disclosure NOT NULL DEFAULT 'not_mentioned',
  fee_amount            numeric(12,2),
  fee_pct               numeric(5,2),
  qualifies_for_bonus   boolean,
  source_url            text NOT NULL,
  captured_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, payment_method_id, direction, currency)
);

-- ---------------------------------------------------------------------------
-- PAYOUT CAPS  (bet365 publishes a full per-sport table - genuinely comparable)
-- ---------------------------------------------------------------------------

CREATE TABLE operation_payout_cap (
  id             serial PRIMARY KEY,
  operation_id   int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  scope          text NOT NULL,                          -- 'default' | sport code | competition tier label
  sport_id       int REFERENCES sport(id),
  competition_id int REFERENCES competition(id),
  cap_amount     numeric(14,2) NOT NULL,
  currency       char(3) NOT NULL,
  period         text NOT NULL DEFAULT 'per_bet',        -- per_bet | per_day
  source_url     text NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TERMS CLAUSES  (verbatim, hashed, dated - this is the trust layer)
-- ---------------------------------------------------------------------------

CREATE TABLE operation_clause (
  id            serial PRIMARY KEY,
  operation_id  int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  type          clause_type NOT NULL,
  present       boolean NOT NULL,                        -- false = we looked and it is not there
  verbatim      text,
  section_ref   text,                                    -- 'T&C 16.2(e)'
  parsed_json   jsonb,                                   -- structured extract, shape depends on type
  source_url    text NOT NULL,
  content_hash  text,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  confidence    confidence NOT NULL DEFAULT 'verbatim',
  UNIQUE (operation_id, type)
);
CREATE INDEX clause_type_idx ON operation_clause(type) WHERE present;

-- ---------------------------------------------------------------------------
-- SPORT / MARKET COVERAGE
-- ---------------------------------------------------------------------------

CREATE TABLE operation_sport_coverage (
  operation_id     int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  sport_id         int NOT NULL REFERENCES sport(id),
  offered          boolean NOT NULL,
  has_player_props boolean,
  has_live_betting boolean,
  source_url       text,
  captured_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, sport_id)
);

-- Market breadth is a MEASUREMENT over time, not a static attribute.
-- Populated from /events/{id}/markets, which costs 1 credit per call.
CREATE TABLE operation_market_sample (
  id             serial PRIMARY KEY,
  operation_id   int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  competition_id int NOT NULL REFERENCES competition(id),
  event_id       text NOT NULL,                          -- Odds API event id
  market_keys    text[] NOT NULL,
  market_count   int GENERATED ALWAYS AS (cardinality(market_keys)) STORED,
  sampled_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_sample_idx ON operation_market_sample(operation_id, sampled_at DESC);

-- ---------------------------------------------------------------------------
-- RESPONSIBLE GAMBLING
-- ---------------------------------------------------------------------------

CREATE TABLE operation_rg (
  operation_id           int PRIMARY KEY REFERENCES operation(id) ON DELETE CASCADE,
  deposit_limit          boolean,
  loss_limit             boolean,
  session_limit          boolean,
  time_out               boolean,
  reality_check          boolean,
  self_exclusion         boolean,
  national_scheme        text,                           -- 'GAMSTOP','BetStop','NJ DGE self-exclusion'
  helpline_named         text,
  source_url             text,
  captured_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- EXCHANGE COMMISSION  (only exchanges publish real pricing - high value)
-- ---------------------------------------------------------------------------

CREATE TABLE exchange_commission (
  operation_id        int PRIMARY KEY REFERENCES operation(id) ON DELETE CASCADE,
  base_rate_pct       numeric(5,2),
  discount_mechanic   text,
  premium_charge_json jsonb,                             -- tiered charge bands
  source_url          text NOT NULL,
  captured_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- LINK MANAGEMENT  (affiliate-ready; direct links today)
-- ---------------------------------------------------------------------------

CREATE TABLE operation_link (
  id             serial PRIMARY KEY,
  operation_id   int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  kind           link_kind NOT NULL DEFAULT 'direct',
  placement      text NOT NULL DEFAULT 'default',        -- default|odds_table|review|bonus_table|toplist
  geo            geo_market,                             -- geo-specific creative
  target_url     text NOT NULL,
  tracker_id     text,
  network        text,                                   -- 'income_access','netrefer','direct'
  rev_share_note text,
  nofollow       boolean NOT NULL DEFAULT true,
  sponsored      boolean NOT NULL DEFAULT true,
  is_active      boolean NOT NULL DEFAULT true,
  valid_from     date,
  valid_to       date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX link_lookup_idx ON operation_link(operation_id, placement, geo) WHERE is_active;

-- Click log for the /go/ redirect layer. Deliberately minimal - no PII.
CREATE TABLE link_click (
  id           bigserial PRIMARY KEY,
  link_id      int NOT NULL REFERENCES operation_link(id),
  clicked_at   timestamptz NOT NULL DEFAULT now(),
  geo          geo_market,
  page_path    text,
  device       text,
  referrer_host text,
  session_hash text                                       -- salted hash, not an identifier
);
CREATE INDEX click_link_time_idx ON link_click(link_id, clicked_at DESC);

-- ---------------------------------------------------------------------------
-- COMPUTED MARGIN  (our differentiator - derived from our own odds feed,
-- because no bookmaker publishes its margins)
-- ---------------------------------------------------------------------------

CREATE TABLE operation_margin (
  id             bigserial PRIMARY KEY,
  operation_id   int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  sport_id       int NOT NULL REFERENCES sport(id),
  competition_id int REFERENCES competition(id),
  market_key     text NOT NULL,                           -- 'h2h','spreads','totals'
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  sample_size    int NOT NULL,                            -- number of markets measured
  margin_mean    numeric(6,4) NOT NULL,                   -- overround - 1, e.g. 0.0476
  margin_median  numeric(6,4),
  margin_p25     numeric(6,4),
  margin_p75     numeric(6,4),
  rank_in_geo    int,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, sport_id, competition_id, market_key, period_start, period_end)
);
CREATE INDEX margin_leaderboard_idx ON operation_margin(sport_id, market_key, period_end DESC, margin_mean);

-- How often this book actually posts the best price in our comparison.
CREATE TABLE operation_best_price_rate (
  id             bigserial PRIMARY KEY,
  operation_id   int NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
  sport_id       int NOT NULL REFERENCES sport(id),
  market_key     text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  outcomes_compared int NOT NULL,
  best_price_count  int NOT NULL,
  best_price_pct numeric(5,2) GENERATED ALWAYS AS
    (CASE WHEN outcomes_compared > 0
          THEN round(100.0 * best_price_count / outcomes_compared, 2) ELSE NULL END) STORED,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, sport_id, market_key, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- PROVENANCE LEDGER  (one row per page we read; everything above points back)
-- ---------------------------------------------------------------------------

CREATE TABLE source_capture (
  id            bigserial PRIMARY KEY,
  operation_id  int REFERENCES operation(id) ON DELETE CASCADE,
  url           text NOT NULL,
  page_role     text NOT NULL,               -- 'terms','payments','bonus','footer','help','register'
  http_status   int,
  content_hash  text NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  fetched_by    text NOT NULL DEFAULT 'claude',
  render_mode   text NOT NULL DEFAULT 'browser', -- most books 403 plain fetches
  raw_text_path text
);
CREATE INDEX capture_op_role_idx ON source_capture(operation_id, page_role, fetched_at DESC);

-- Change detection: fires when a hash we already stored changes.
CREATE VIEW stale_operation AS
SELECT o.id, o.slug, o.geo, o.last_verified_at,
       now() - o.last_verified_at AS age
FROM operation o
WHERE o.status = 'active'
  AND (o.last_verified_at IS NULL OR o.last_verified_at < now() - interval '90 days');

-- ============================================================
-- 02_seed.sql
-- ============================================================

-- 02_seed.sql  Generated from The Odds API bookmaker key list (Sep 2026).
-- Rows with NULL odds_api_bookmaker_key are editorial-only: we hold data, not live prices.
SET search_path TO tve, public;

-- BRANDS
INSERT INTO brand (slug,name) VALUES ('1xbet','1xBet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('888sport','888sport') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('ballybet','Bally Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('bet365','bet365') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('bet99','BET99') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betano','Betano') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betanysports','BetAnySports') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betclic','Betclic') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betfair','Betfair') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betfred','Betfred') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betmgm','BetMGM') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betonline','BetOnline.ag') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betopenly','BetOpenly') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betparx','betPARX') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betr','Betr') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betright','Bet Right') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betrivers','BetRivers') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betsson','Betsson') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betus','BetUS') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betvictor','Bet Victor') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('betway','Betway') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('bovada','Bovada') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('boylesports','BoyleSports') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('caesars','Caesars') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('casumo','Casumo') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('codere','Codere') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('coolbet','Coolbet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('coral','Coral') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('dabble','Dabble') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('draftkings','DraftKings') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('espnbet','theScore Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('everygame','Everygame') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('fanatics','Fanatics') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('fanduel','FanDuel') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('fliff','Fliff') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('grosvenor','Grosvenor') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('gtbets','GTbets') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('hardrockbet','Hard Rock Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('kalshi','Kalshi') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('ladbrokes','Ladbrokes') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('leovegas','LeoVegas') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('livescorebet','LiveScore Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('lowvig','LowVig.ag') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('marathonbet','Marathon Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('matchbook','Matchbook') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('mybookie','MyBookie.ag') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('neds','Neds') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('nordicbet','NordicBet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('novig','Novig') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('paddypower','Paddy Power') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('pinnacle','Pinnacle') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('playnow','PlayNow') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('playup','PlayUp') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('pmu','PMU') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('pointsbet','PointsBet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('polymarket','Polymarket') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('prizepicks','PrizePicks') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('proline','PROLINE') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('prophetx','ProphetX') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('rebet','ReBet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('skybet','Sky Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('smarkets','Smarkets') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('sportsbet','Sportsbet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('sportsinteraction','Sports Interaction') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('stake','Stake') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('suprabets','Suprabets') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('tab','TAB') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('tabtouch','TABtouch') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('tipico','Tipico') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('underdog','Underdog Fantasy') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('unibet','Unibet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('virginbet','Virgin Bet') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('williamhill','William Hill') ON CONFLICT (slug) DO NOTHING;
INSERT INTO brand (slug,name) VALUES ('winamax','Winamax') ON CONFLICT (slug) DO NOTHING;

-- OPERATIONS
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'1xbet-onexbet','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'onexbet','eu'::odds_api_region FROM brand WHERE slug='1xbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'888sport-sport888','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'sport888','eu'::odds_api_region FROM brand WHERE slug='888sport' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betclic-betclic-fr','row'::geo_market,'France','FR','TBC','sportsbook'::operator_model,'betclic_fr','eu'::odds_api_region FROM brand WHERE slug='betclic' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betanysports-betanysports','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'betanysports','eu'::odds_api_region FROM brand WHERE slug='betanysports' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betfair-betfair-ex-eu','row'::geo_market,'Europe',NULL,'TBC','exchange'::operator_model,'betfair_ex_eu','eu'::odds_api_region FROM brand WHERE slug='betfair' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betonline-betonlineag','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'betonlineag','eu'::odds_api_region FROM brand WHERE slug='betonline' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betsson-betsson','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'betsson','eu'::odds_api_region FROM brand WHERE slug='betsson' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'codere-codere-it','row'::geo_market,'Italy','IT','TBC','sportsbook'::operator_model,'codere_it','eu'::odds_api_region FROM brand WHERE slug='codere' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betvictor-betvictor','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'betvictor','eu'::odds_api_region FROM brand WHERE slug='betvictor' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'coolbet-coolbet','row'::geo_market,'Nordics',NULL,'TBC','sportsbook'::operator_model,'coolbet','eu'::odds_api_region FROM brand WHERE slug='coolbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'everygame-everygame','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'everygame','eu'::odds_api_region FROM brand WHERE slug='everygame' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'gtbets-gtbets','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'gtbets','eu'::odds_api_region FROM brand WHERE slug='gtbets' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'leovegas-leovegas-se','row'::geo_market,'Sweden','SE','TBC','sportsbook'::operator_model,'leovegas_se','eu'::odds_api_region FROM brand WHERE slug='leovegas' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'marathonbet-marathonbet','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'marathonbet','eu'::odds_api_region FROM brand WHERE slug='marathonbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'matchbook-matchbook','row'::geo_market,'Rest of World',NULL,'TBC','exchange'::operator_model,'matchbook','eu'::odds_api_region FROM brand WHERE slug='matchbook' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'mybookie-mybookieag','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'mybookieag','eu'::odds_api_region FROM brand WHERE slug='mybookie' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'nordicbet-nordicbet','row'::geo_market,'Nordics',NULL,'TBC','sportsbook'::operator_model,'nordicbet','eu'::odds_api_region FROM brand WHERE slug='nordicbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'pinnacle-pinnacle','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'pinnacle','eu'::odds_api_region FROM brand WHERE slug='pinnacle' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'pmu-pmu-fr','row'::geo_market,'France','FR','TBC','sportsbook'::operator_model,'pmu_fr','eu'::odds_api_region FROM brand WHERE slug='pmu' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'suprabets-suprabets','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,'suprabets','eu'::odds_api_region FROM brand WHERE slug='suprabets' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'tipico-tipico-de','row'::geo_market,'Germany','DE','TBC','sportsbook'::operator_model,'tipico_de','eu'::odds_api_region FROM brand WHERE slug='tipico' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet-fr','row'::geo_market,'France','FR','TBC','sportsbook'::operator_model,'unibet_fr','eu'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet-it','row'::geo_market,'Italy','IT','TBC','sportsbook'::operator_model,'unibet_it','eu'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet-nl','row'::geo_market,'Netherlands','NL','TBC','sportsbook'::operator_model,'unibet_nl','eu'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet-se','row'::geo_market,'Sweden','SE','TBC','sportsbook'::operator_model,'unibet_se','eu'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'winamax-winamax-de','row'::geo_market,'Germany','DE','TBC','sportsbook'::operator_model,'winamax_de','eu'::odds_api_region FROM brand WHERE slug='winamax' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'winamax-winamax-fr','row'::geo_market,'France','FR','TBC','sportsbook'::operator_model,'winamax_fr','eu'::odds_api_region FROM brand WHERE slug='winamax' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'888sport-united-kingdom','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,NULL,NULL FROM brand WHERE slug='888sport' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betano-betano-uk','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'betano_uk','uk'::odds_api_region FROM brand WHERE slug='betano' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betfair-betfair-ex-uk','row'::geo_market,'United Kingdom','GB','TBC','exchange'::operator_model,'betfair_ex_uk','uk'::odds_api_region FROM brand WHERE slug='betfair' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betfair-betfair-sb-uk','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'betfair_sb_uk','uk'::odds_api_region FROM brand WHERE slug='betfair' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betfred-betfred-uk','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'betfred_uk','uk'::odds_api_region FROM brand WHERE slug='betfred' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betway-betway','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'betway','uk'::odds_api_region FROM brand WHERE slug='betway' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'boylesports-boylesports','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'boylesports','uk'::odds_api_region FROM brand WHERE slug='boylesports' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'casumo-casumo','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'casumo','uk'::odds_api_region FROM brand WHERE slug='casumo' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'coral-coral','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'coral','uk'::odds_api_region FROM brand WHERE slug='coral' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'grosvenor-grosvenor','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'grosvenor','uk'::odds_api_region FROM brand WHERE slug='grosvenor' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'ladbrokes-ladbrokes-uk','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'ladbrokes_uk','uk'::odds_api_region FROM brand WHERE slug='ladbrokes' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'leovegas-leovegas','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'leovegas','uk'::odds_api_region FROM brand WHERE slug='leovegas' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'livescorebet-livescorebet','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'livescorebet','uk'::odds_api_region FROM brand WHERE slug='livescorebet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'paddypower-paddypower','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'paddypower','uk'::odds_api_region FROM brand WHERE slug='paddypower' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'skybet-skybet','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'skybet','uk'::odds_api_region FROM brand WHERE slug='skybet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'smarkets-smarkets','row'::geo_market,'United Kingdom','GB','TBC','exchange'::operator_model,'smarkets','uk'::odds_api_region FROM brand WHERE slug='smarkets' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet-uk','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'unibet_uk','uk'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'virginbet-virginbet','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'virginbet','uk'::odds_api_region FROM brand WHERE slug='virginbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'williamhill-williamhill','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,'williamhill','uk'::odds_api_region FROM brand WHERE slug='williamhill' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betmgm-betmgm','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'betmgm','us'::odds_api_region FROM brand WHERE slug='betmgm' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betrivers-betrivers','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'betrivers','us'::odds_api_region FROM brand WHERE slug='betrivers' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betus-betus','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'betus','us'::odds_api_region FROM brand WHERE slug='betus' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'bovada-bovada','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'bovada','us'::odds_api_region FROM brand WHERE slug='bovada' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'caesars-williamhill-us','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'williamhill_us','us'::odds_api_region FROM brand WHERE slug='caesars' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'draftkings-draftkings','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'draftkings','us'::odds_api_region FROM brand WHERE slug='draftkings' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'fanatics-fanatics','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'fanatics','us'::odds_api_region FROM brand WHERE slug='fanatics' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'fanduel-fanduel','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'fanduel','us'::odds_api_region FROM brand WHERE slug='fanduel' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'lowvig-lowvig','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'lowvig','us'::odds_api_region FROM brand WHERE slug='lowvig' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'ballybet-ballybet','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'ballybet','us2'::odds_api_region FROM brand WHERE slug='ballybet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betparx-betparx','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'betparx','us2'::odds_api_region FROM brand WHERE slug='betparx' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'espnbet-espnbet','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'espnbet','us2'::odds_api_region FROM brand WHERE slug='espnbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'fliff-fliff','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'fliff','us2'::odds_api_region FROM brand WHERE slug='fliff' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'hardrockbet-hardrockbet','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'hardrockbet','us2'::odds_api_region FROM brand WHERE slug='hardrockbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'rebet-rebet','us'::geo_market,'United States','US','TBC','sportsbook'::operator_model,'rebet','us2'::odds_api_region FROM brand WHERE slug='rebet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betopenly-betopenly','us'::geo_market,'United States','US','TBC','exchange'::operator_model,'betopenly','us_ex'::odds_api_region FROM brand WHERE slug='betopenly' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'kalshi-kalshi','us'::geo_market,'United States','US','TBC','prediction_market'::operator_model,'kalshi','us_ex'::odds_api_region FROM brand WHERE slug='kalshi' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'novig-novig','us'::geo_market,'United States','US','TBC','exchange'::operator_model,'novig','us_ex'::odds_api_region FROM brand WHERE slug='novig' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'polymarket-polymarket','us'::geo_market,'United States','US','TBC','prediction_market'::operator_model,'polymarket','us_ex'::odds_api_region FROM brand WHERE slug='polymarket' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'prophetx-prophetx','us'::geo_market,'United States','US','TBC','exchange'::operator_model,'prophetx','us_ex'::odds_api_region FROM brand WHERE slug='prophetx' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'prizepicks-prizepicks','us'::geo_market,'United States','US','TBC','dfs'::operator_model,'prizepicks','us_dfs'::odds_api_region FROM brand WHERE slug='prizepicks' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'underdog-underdog','us'::geo_market,'United States','US','TBC','dfs'::operator_model,'underdog','us_dfs'::odds_api_region FROM brand WHERE slug='underdog' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'dabble-dabble-us-dfs','us'::geo_market,'United States','US','TBC','dfs'::operator_model,'dabble_us_dfs','us_dfs'::odds_api_region FROM brand WHERE slug='dabble' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'draftkings-pick6','us'::geo_market,'United States','US','TBC','dfs'::operator_model,'pick6','us_dfs'::odds_api_region FROM brand WHERE slug='draftkings' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'bet99-bet99-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'bet99_ca_on','ca'::odds_api_region FROM brand WHERE slug='bet99' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betano-betano-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'betano_ca_on','ca'::odds_api_region FROM brand WHERE slug='betano' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betmgm-betmgm-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'betmgm_ca_on','ca'::odds_api_region FROM brand WHERE slug='betmgm' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betrivers-betrivers-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'betrivers_ca_on','ca'::odds_api_region FROM brand WHERE slug='betrivers' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'playnow-playnow-ca','ca'::geo_market,'British Columbia','CA','TBC','sportsbook'::operator_model,'playnow_ca','ca'::odds_api_region FROM brand WHERE slug='playnow' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'pointsbet-pointsbetca','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'pointsbetca','ca'::odds_api_region FROM brand WHERE slug='pointsbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'proline-proline-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'proline_ca_on','ca'::odds_api_region FROM brand WHERE slug='proline' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'sportsinteraction-sportsinteraction-ca-on','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,'sportsinteraction_ca_on','ca'::odds_api_region FROM brand WHERE slug='sportsinteraction' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betfair-betfair-ex-au','au'::geo_market,'Australia','AU','TBC','exchange'::operator_model,'betfair_ex_au','au'::odds_api_region FROM brand WHERE slug='betfair' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betr-betr-au','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'betr_au','au'::odds_api_region FROM brand WHERE slug='betr' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'betright-betright','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'betright','au'::odds_api_region FROM brand WHERE slug='betright' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'bet365-bet365-au','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'bet365_au','au'::odds_api_region FROM brand WHERE slug='bet365' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'dabble-dabble-au','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'dabble_au','au'::odds_api_region FROM brand WHERE slug='dabble' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'ladbrokes-ladbrokes-au','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'ladbrokes_au','au'::odds_api_region FROM brand WHERE slug='ladbrokes' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'neds-neds','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'neds','au'::odds_api_region FROM brand WHERE slug='neds' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'playup-playup','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'playup','au'::odds_api_region FROM brand WHERE slug='playup' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'pointsbet-pointsbetau','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'pointsbetau','au'::odds_api_region FROM brand WHERE slug='pointsbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'sportsbet-sportsbet','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'sportsbet','au'::odds_api_region FROM brand WHERE slug='sportsbet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'tab-tab','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'tab','au'::odds_api_region FROM brand WHERE slug='tab' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'tabtouch-tabtouch','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'tabtouch','au'::odds_api_region FROM brand WHERE slug='tabtouch' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'unibet-unibet','au'::geo_market,'Australia','AU','TBC','sportsbook'::operator_model,'unibet','au'::odds_api_region FROM brand WHERE slug='unibet' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'bet365-united-kingdom','row'::geo_market,'United Kingdom','GB','TBC','sportsbook'::operator_model,NULL,NULL FROM brand WHERE slug='bet365' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'bet365-ontario','ca'::geo_market,'Ontario','CA','TBC','sportsbook'::operator_model,NULL,NULL FROM brand WHERE slug='bet365' ON CONFLICT (slug) DO NOTHING;
INSERT INTO operation (brand_id,slug,geo,market_label,country_iso2,domain,model,odds_api_bookmaker_key,odds_api_region) SELECT id,'stake-rest-of-world','row'::geo_market,'Rest of World',NULL,'TBC','sportsbook'::operator_model,NULL,NULL FROM brand WHERE slug='stake' ON CONFLICT (slug) DO NOTHING;

-- GEO -> Odds API region map
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('row'::geo_market,'eu'::odds_api_region,true) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('row'::geo_market,'uk'::odds_api_region,false) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('us'::geo_market,'us'::odds_api_region,true) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('us'::geo_market,'us2'::odds_api_region,false) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('us'::geo_market,'us_ex'::odds_api_region,false) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('us'::geo_market,'us_dfs'::odds_api_region,false) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('ca'::geo_market,'ca'::odds_api_region,true) ON CONFLICT DO NOTHING;
INSERT INTO geo_region_map (geo,api_region,is_primary) VALUES ('au'::geo_market,'au'::odds_api_region,true) ON CONFLICT DO NOTHING;

-- ============================================================
-- 03_reference.sql
-- ============================================================

-- 03_reference.sql  Regulators, payment methods, sports, competitions.
SET search_path TO tve, public;

-- REGULATORS
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('ukgc','Gambling Commission (Great Britain)','GB',NULL,'https://www.gamblingcommission.gov.uk/public-register/businesses',true,1,'Free public register, searchable by name/trading name/DOMAIN, bulk CSV download, includes regulatory actions. Best-in-class - hold a local copy.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('mga','Malta Gaming Authority','MT',NULL,'https://mgalicenseeregister.mga.org.mt/',false,1,'Public but a JS SPA - needs a real browser. Operator footer ''dynamic seal'' links straight to the record; usually the fastest verification path.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('gib','Gibraltar Licensing Authority','GI',NULL,NULL,false,1,'bet365 UK operates under Gibraltar RGL 130/129 via Hillside entities.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('on_igo','iGaming Ontario / AGCO','CA','ON','https://www.igamingontario.ca/en/operator/operators',true,1,'Lists legal entity, brands and AUTHORISED SITE URLS. Publishes NO registration numbers - expect no_number_published.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('nj_dge','NJ Division of Gaming Enforcement','US','NJ',NULL,false,1,'Per-state. Operators name the DGE but rarely a licence number.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('nt_racing','NT Racing and Wagering Commission','AU','NT',NULL,false,1,'Most AU corporate bookmakers licence here. Regulator named, number typically not published.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('anj_fr','Autorite Nationale des Jeux','FR',NULL,NULL,false,1,NULL) ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('cga_cw','Curacao Gaming Authority','CW',NULL,'https://www.cga.cw/',false,2,'Publishes PDF registries, not a searchable register, and disclaims currency of the data. Legacy master/sub-licences migrating to OGL/ format - expect register_no_match.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('anjouan','Anjouan / Mwali Offshore Finance Authority','KM',NULL,NULL,false,3,'No functioning public register. Any number cited is an unverifiable claim - set no_public_register.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('bc_bclc','British Columbia Lottery Corporation','CA','BC',NULL,false,1,'PlayNow - provincial monopoly.') ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('se_sgi','Spelinspektionen','SE',NULL,NULL,false,1,NULL) ON CONFLICT (code) DO NOTHING;
INSERT INTO regulator (code,name,country_iso2,subdivision,register_url,register_machine_readable,consumer_protection_tier,notes) VALUES ('de_gglh','Gemeinsame Gluecksspielbehoerde der Laender','DE',NULL,NULL,false,1,NULL) ON CONFLICT (code) DO NOTHING;

-- PAYMENT METHODS
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('visa','Visa','card',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('mastercard','Mastercard','card',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('maestro','Maestro','card',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('amex','American Express','card',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('paypal','PayPal','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('skrill','Skrill','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('neteller','Neteller','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('trustly','Trustly','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('apple_pay','Apple Pay','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('google_pay','Google Pay','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('bank_transfer','Bank Transfer','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('fast_bank_transfer','Fast Bank Transfer','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('paysafecard','paysafecard','prepaid',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('interac','Interac','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('idebit','iDebit','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('instadebit','InstaDebit','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('poli','POLi','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('payid','PayID / Osko','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('bpay','BPAY','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('ach','ACH / eCheck','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('play_plus','Play+','prepaid',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('venmo','Venmo','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('cash_at_cage','Cash at Casino Cage','cash',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('mifinity','MiFinity','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('ecopayz','ecoPayz / Payz','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('revolut','Revolut','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('klarna','Klarna','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('btc','Bitcoin','crypto',true) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('eth','Ethereum','crypto',true) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('usdt','Tether USDT','crypto',true) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('ltc','Litecoin','crypto',true) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('swish','Swish','mobile',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('mobilepay','MobilePay','mobile',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('vipps','Vipps','mobile',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('giropay','Giropay','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('sofort','Sofort','bank',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('astropay','AstroPay','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('jeton','Jeton','ewallet',false) ON CONFLICT (code) DO NOTHING;
INSERT INTO payment_method (code,name,category,is_crypto) VALUES ('cheque','Cheque','bank',false) ON CONFLICT (code) DO NOTHING;

-- SPORTS
INSERT INTO sport (code,name,odds_api_group) VALUES ('soccer','Football (Soccer)','Soccer') ON CONFLICT (code) DO NOTHING;
INSERT INTO sport (code,name,odds_api_group) VALUES ('tennis','Tennis','Tennis') ON CONFLICT (code) DO NOTHING;
INSERT INTO sport (code,name,odds_api_group) VALUES ('americanfootball','American Football','American Football') ON CONFLICT (code) DO NOTHING;
INSERT INTO sport (code,name,odds_api_group) VALUES ('basketball','Basketball','Basketball') ON CONFLICT (code) DO NOTHING;

-- COMPETITIONS (one row per Odds API sport key, 4 target sports)
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_cfl','CFL',false,false,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_ncaaf','NCAAF',false,false,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_ncaaf_championship_winner','NCAAF Championship Winner',false,true,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_ncaaf_fcs','NCAAF FCS',false,false,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_nfl','NFL',false,false,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_nfl_preseason','NFL Preseason',false,false,NULL FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_nfl_super_bowl_winner','NFL Super Bowl Winner',false,true,now() FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'americanfootball_ufl','UFL',false,false,NULL FROM sport WHERE code='americanfootball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_euroleague','Basketball Euroleague',false,false,now() FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nba','NBA',false,false,now() FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nba_all_stars','NBA All Star',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nba_championship_winner','NBA Championship Winner',false,true,now() FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nba_preseason','NBA Preseason',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nba_summer_league','NBA Summer League',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_nbl','NBL',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_ncaab','NCAAB',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_ncaab_championship_winner','NCAAB Championship Winner',false,true,now() FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_wnba','WNBA',false,false,now() FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'basketball_wncaab','WNCAAB',false,false,NULL FROM sport WHERE code='basketball' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_africa_cup_of_nations','Africa Cup of Nations',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_argentina_primera_division','Primera División - Argentina',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_australia_aleague','A-League',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_austria_bundesliga','Austrian Football Bundesliga',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_belgium_first_div','Belgium First Div',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_brazil_campeonato','Brazil Série A',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_brazil_serie_b','Brazil Série B',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_chile_campeonato','Primera División - Chile',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_china_superleague','Super League - China',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_concacaf_gold_cup','CONCACAF Gold Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_concacaf_leagues_cup','Leagues Cup',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_conmebol_copa_america','Copa América',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_conmebol_copa_libertadores','Copa Libertadores',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_conmebol_copa_sudamericana','Copa Sudamericana',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_denmark_superliga','Denmark Superliga',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_efl_champ','Championship',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_england_efl_cup','EFL Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_england_league1','League 1',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_england_league2','League 2',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_epl','EPL',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fa_cup','FA Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_club_world_cup','FIFA Club World Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_world_cup','FIFA World Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_world_cup_qualifiers_europe','FIFA World Cup Qualifiers - Europe',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_world_cup_qualifiers_south_america','FIFA World Cup Qualifiers - South America',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_world_cup_winner','FIFA World Cup Winner',false,true,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_fifa_world_cup_womens','FIFA Women''s World Cup',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_finland_veikkausliiga','Veikkausliiga - Finland',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_france_coupe_de_france','Coupe de France',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_france_ligue_one','Ligue 1 - France',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_france_ligue_two','Ligue 2 - France',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_germany_bundesliga','Bundesliga - Germany',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_germany_bundesliga2','Bundesliga 2 - Germany',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_germany_bundesliga_women','Frauen-Bundesliga',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_germany_dfb_pokal','DFB-Pokal',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_germany_liga3','3. Liga - Germany',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_greece_super_league','Super League - Greece',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_italy_coppa_italia','Coppa Italia',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_italy_serie_a','Serie A - Italy',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_italy_serie_b','Serie B - Italy',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_japan_j_league','J League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_korea_kleague1','K League 1',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_league_of_ireland','League of Ireland',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_mexico_ligamx','Liga MX',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_netherlands_eredivisie','Dutch Eredivisie',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_norway_eliteserien','Eliteserien - Norway',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_poland_ekstraklasa','Ekstraklasa - Poland',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_portugal_primeira_liga','Primeira Liga - Portugal',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_russia_premier_league','Premier League - Russia',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_saudi_arabia_pro_league','Saudi Pro League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_spain_copa_del_rey','Copa del Rey',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_spain_la_liga','La Liga - Spain',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_spain_segunda_division','La Liga 2 - Spain',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_spl','Premiership - Scotland',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_sweden_allsvenskan','Allsvenskan - Sweden',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_sweden_superettan','Superettan - Sweden',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_switzerland_superleague','Swiss Superleague',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_turkey_super_league','Turkey Super League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_champs_league','UEFA Champions League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_champs_league_qualification','UEFA Champions League Qualification',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_champs_league_women','UEFA Champions League Women',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_euro_qualification','UEFA Euro Qualification',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_europa_conference_league','UEFA Europa Conference League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_europa_league','UEFA Europa League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_european_championship','UEFA Euro',false,false,NULL FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_uefa_nations_league','UEFA Nations League',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'soccer_usa_mls','MLS',false,false,now() FROM sport WHERE code='soccer' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_aus_open_singles','ATP Australian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_barcelona_open','ATP Barcelona Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_canadian_open','ATP Canadian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_china_open','ATP China Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_cincinnati_open','ATP Cincinnati Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_dubai','ATP Dubai',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_french_open','ATP French Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_halle_open','ATP Halle Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_hamburg_open','ATP Hamburg Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_indian_wells','ATP Indian Wells',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_italian_open','ATP Italian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_madrid_open','ATP Madrid Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_miami_open','ATP Miami Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_monte_carlo_masters','ATP Monte-Carlo Masters',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_munich','ATP Munich',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_paris_masters','ATP Paris Masters',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_qatar_open','ATP Qatar Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_queens_club_champ','ATP Queen''s Club Championships',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_shanghai_masters','ATP Shanghai Masters',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_us_open','ATP US Open',true,false,now() FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_washington_open','ATP Washington Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_atp_wimbledon','ATP Wimbledon',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_aus_open_singles','WTA Australian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_bad_homburg_open','WTA Bad Homburg Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_canadian_open','WTA Canadian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_charleston_open','WTA Charleston Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_china_open','WTA China Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_cincinnati_open','WTA Cincinnati Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_dubai','WTA Dubai Championships',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_french_open','WTA French Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_german_open','WTA German Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_indian_wells','WTA Indian Wells',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_italian_open','WTA Italian Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_madrid_open','WTA Madrid Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_miami_open','WTA Miami Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_monterrey_open','WTA Monterrey Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_qatar_open','WTA Qatar Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_queens_club_champ','WTA Queen''s Club Championships',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_strasbourg','WTA Internationaux de Strasbourg',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_stuttgart_open','WTA Stuttgart Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_us_open','WTA US Open',true,false,now() FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_washington_open','WTA Washington Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_wimbledon','WTA Wimbledon',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;
INSERT INTO competition (sport_id,odds_api_sport_key,title,is_tournament_key,is_outright_key,active_last_seen) SELECT id,'tennis_wta_wuhan_open','WTA Wuhan Open',true,false,NULL FROM sport WHERE code='tennis' ON CONFLICT (odds_api_sport_key) DO NOTHING;

-- ============================================================
-- 04_derived_metrics.sql
-- ============================================================

-- ============================================================================
-- 04_derived_metrics.sql
-- The computed layer. This is the part no bookmaker publishes and no competitor
-- can copy without their own odds history: real measured margin per book.
--
-- INTERFACE: expects the odds engine to write into tve.odds_snapshot:
--   event_id text, competition_id int, bookmaker_key text, market_key text,
--   outcome_name text, price numeric, captured_at timestamptz
-- One row per outcome per book per snapshot. This is the same shape the
-- Odds API returns, so the ingest is a flatten, not a transform.
-- ============================================================================
SET search_path TO tve, public;

CREATE TABLE IF NOT EXISTS odds_snapshot (
  id            bigserial PRIMARY KEY,
  event_id      text NOT NULL,
  competition_id int NOT NULL REFERENCES competition(id),
  bookmaker_key text NOT NULL,
  market_key    text NOT NULL,
  outcome_name  text NOT NULL,
  point         numeric(8,2),
  price         numeric(10,4) NOT NULL,
  bet_limit     numeric(14,2),
  deep_link     text,
  captured_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS odds_snapshot_lookup
  ON odds_snapshot (event_id, market_key, bookmaker_key, captured_at DESC);
CREATE INDEX IF NOT EXISTS odds_snapshot_time ON odds_snapshot (captured_at DESC);

-- ---------------------------------------------------------------------------
-- Overround per (book, event, market) at a point in time.
-- margin = sum(1/price) - 1.  A fair book would be 0. -110/-110 = 0.0476.
-- Only complete markets are counted: a partial set of outcomes gives a
-- meaningless (too low) margin, which is the classic way these tables lie.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_market_margin AS
WITH latest AS (
  SELECT DISTINCT ON (event_id, market_key, bookmaker_key, outcome_name, point)
         event_id, competition_id, market_key, bookmaker_key,
         outcome_name, point, price, captured_at
  FROM odds_snapshot
  ORDER BY event_id, market_key, bookmaker_key, outcome_name, point, captured_at DESC
),
agg AS (
  SELECT event_id, competition_id, market_key, bookmaker_key, point,
         count(*)              AS n_outcomes,
         sum(1.0 / price)      AS implied_sum,
         max(captured_at)      AS captured_at
  FROM latest
  WHERE price > 1.0
    AND market_key NOT LIKE '%\_lay'   -- lay prices are not comparable to back prices
  GROUP BY event_id, competition_id, market_key, bookmaker_key, point
),
expected AS (
  -- Completeness rule is (sport, market), NOT market alone: h2h is 3-way in
  -- soccer (draw) but 2-way in tennis / NFL / NBA. Keying on market alone
  -- silently drops every non-soccer market from the leaderboard.
  SELECT * FROM (VALUES
    ('soccer','h2h',3),('soccer','h2h_3_way',3),('soccer','btts',2),
    ('soccer','draw_no_bet',2),('soccer','totals',2),('soccer','spreads',2),
    ('soccer','h2h_h1',3),
    ('tennis','h2h',2),('tennis','totals',2),('tennis','spreads',2),
    ('americanfootball','h2h',2),('americanfootball','spreads',2),
    ('americanfootball','totals',2),('americanfootball','h2h_q1',2),
    ('basketball','h2h',2),('basketball','spreads',2),('basketball','totals',2),
    ('basketball','h2h_q1',2)
  ) AS t(sport_code, market_key, required_outcomes)
)
SELECT a.event_id, a.competition_id, a.market_key, a.bookmaker_key, a.point,
       a.n_outcomes, a.implied_sum,
       (a.implied_sum - 1.0)::numeric(8,5) AS margin,
       a.captured_at
FROM agg a
JOIN competition c ON c.id = a.competition_id
JOIN sport sp      ON sp.id = c.sport_id
LEFT JOIN expected e ON e.market_key = a.market_key AND e.sport_code = sp.code
WHERE a.n_outcomes = COALESCE(e.required_outcomes, a.n_outcomes)
  AND a.n_outcomes >= 2
  AND a.implied_sum BETWEEN 1.0 AND 1.60;

-- ---------------------------------------------------------------------------
-- Roll margins up into operation_margin for the leaderboard component.
-- Run weekly. Median is the headline figure; the mean is skewed by longshots.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_operation_margin(p_from date, p_to date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO operation_margin (operation_id, sport_id, competition_id, market_key,
         period_start, period_end, sample_size, margin_mean, margin_median,
         margin_p25, margin_p75)
  SELECT o.id, c.sport_id, v.competition_id, v.market_key, p_from, p_to,
         count(*),
         avg(v.margin)::numeric(6,4),
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY v.margin)::numeric(6,4),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v.margin)::numeric(6,4),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v.margin)::numeric(6,4)
  FROM v_market_margin v
  JOIN operation  o ON o.odds_api_bookmaker_key = v.bookmaker_key
  JOIN competition c ON c.id = v.competition_id
  WHERE v.captured_at >= p_from AND v.captured_at < p_to + 1
  GROUP BY o.id, c.sport_id, v.competition_id, v.market_key
  HAVING count(*) >= 20            -- below this the number is noise; do not publish
  ON CONFLICT (operation_id, sport_id, competition_id, market_key, period_start, period_end)
  DO UPDATE SET sample_size=EXCLUDED.sample_size, margin_mean=EXCLUDED.margin_mean,
                margin_median=EXCLUDED.margin_median, margin_p25=EXCLUDED.margin_p25,
                margin_p75=EXCLUDED.margin_p75, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE operation_margin m SET rank_in_geo = r.rk
  FROM (SELECT om.id, rank() OVER (PARTITION BY o.geo, om.sport_id, om.market_key,
                                                om.period_start ORDER BY om.margin_median) AS rk
        FROM operation_margin om JOIN operation o ON o.id = om.operation_id
        WHERE om.period_start = p_from AND om.period_end = p_to) r
  WHERE m.id = r.id;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Best-price rate: how often a book actually tops our comparison table.
-- The single most persuasive number an odds-comparison site can publish.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_best_price_rate(p_from date, p_to date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO operation_best_price_rate (operation_id, sport_id, market_key,
         period_start, period_end, outcomes_compared, best_price_count)
  WITH latest AS (
    SELECT DISTINCT ON (event_id, market_key, outcome_name, point, bookmaker_key)
           event_id, competition_id, market_key, outcome_name, point,
           bookmaker_key, price
    FROM odds_snapshot
    WHERE captured_at >= p_from AND captured_at < p_to + 1
      AND market_key NOT LIKE '%\_lay'  -- an exchange lay price is not a "best odd"
    ORDER BY event_id, market_key, outcome_name, point, bookmaker_key, captured_at DESC
  ),
  best AS (
    -- point is NULL on h2h/moneyline. GROUP BY treats NULLs as equal, but a
    -- join on a nullable column does not -- so normalise it before joining.
    SELECT event_id, market_key, outcome_name,
           COALESCE(point, -99999) AS point_k, max(price) AS best_price
    FROM latest GROUP BY 1,2,3,4
  ),
  scored AS (
    SELECT l.*, (l.price >= b.best_price) AS is_best
    FROM latest l
    JOIN best b ON b.event_id = l.event_id
               AND b.market_key = l.market_key
               AND b.outcome_name = l.outcome_name
               AND b.point_k = COALESCE(l.point, -99999)
  )
  SELECT o.id, c.sport_id, s.market_key, p_from, p_to,
         count(*), count(*) FILTER (WHERE s.is_best)
  FROM scored s
  JOIN operation  o ON o.odds_api_bookmaker_key = s.bookmaker_key
  JOIN competition c ON c.id = s.competition_id
  GROUP BY o.id, c.sport_id, s.market_key
  HAVING count(*) >= 50
  ON CONFLICT (operation_id, sport_id, market_key, period_start, period_end)
  DO UPDATE SET outcomes_compared=EXCLUDED.outcomes_compared,
                best_price_count=EXCLUDED.best_price_count, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Bonus effective value.
-- Turns "Bet £10 Get £30" and "100% up to £100, 40x, min odds 1.80" into one
-- comparable number: expected retained value per unit of the headline amount.
--   free bet   -> value = face x (1 - 1/min_odds)  [stake not returned]
--   match bonus-> value = amount x survival(wagering, margin at min odds)
-- Deliberately simple and documented on-page. Sophistication that cannot be
-- explained to a reader is worse than a rough number that can.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bonus_effective_value(
  p_type bonus_type, p_amount numeric, p_wager_mult numeric,
  p_min_odds numeric, p_book_margin numeric DEFAULT 0.05
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE odds numeric := COALESCE(p_min_odds, 1.80);
        mult numeric := COALESCE(p_wager_mult, 0);
        edge numeric;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  -- expected loss per unit turned over, at the book's margin
  edge := p_book_margin / GREATEST(odds - 1, 0.01);
  IF p_type IN ('free_bet','bonus_bets','risk_free','bet_insurance') THEN
    -- a free bet returns winnings only
    RETURN round(p_amount * (1 - 1.0/odds) * (1 - LEAST(edge,1)), 4);
  ELSIF p_type IN ('deposit_match','deposit_bonus_tiered','no_deposit') THEN
    IF mult = 0 THEN RETURN round(p_amount, 4); END IF;
    -- survival through mult x turnover, each round losing `edge`
    RETURN round(p_amount * power(GREATEST(1 - edge, 0), mult), 4);
  ELSE
    RETURN NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The component-ready view the frontend actually queries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_bookmaker_card AS
SELECT o.id, o.slug, o.geo, o.market_label, o.domain, o.model,
       b.name AS brand_name, b.logo_url, b.brand_colour_hex,
       o.odds_api_bookmaker_key,
       o.editorial_rating, o.has_cash_out, o.has_bet_builder,
       o.has_live_streaming, o.has_best_odds_guaranteed,
       o.min_deposit_amount, o.min_deposit_currency,
       r.code   AS primary_regulator,
       ol.verification AS licence_status,
       bo.headline AS current_offer,
       bo.effective_value_score,
       m.margin_median AS soccer_h2h_margin,
       bp.best_price_pct,
       l.target_url AS out_url,
       o.last_verified_at
FROM operation o
JOIN brand b ON b.id = o.brand_id
LEFT JOIN LATERAL (SELECT * FROM operation_licence x WHERE x.operation_id=o.id
                   ORDER BY x.verification LIMIT 1) ol ON true
LEFT JOIN regulator r ON r.id = ol.regulator_id
LEFT JOIN LATERAL (SELECT * FROM bonus_offer x WHERE x.operation_id=o.id AND x.is_current
                   ORDER BY x.captured_at DESC LIMIT 1) bo ON true
LEFT JOIN LATERAL (SELECT om.margin_median FROM operation_margin om
                   JOIN sport s ON s.id=om.sport_id AND s.code='soccer'
                   WHERE om.operation_id=o.id AND om.market_key='h2h'
                   ORDER BY om.period_end DESC LIMIT 1) m ON true
LEFT JOIN LATERAL (SELECT x.best_price_pct FROM operation_best_price_rate x
                   JOIN sport s2 ON s2.id=x.sport_id AND s2.code='soccer'
                   WHERE x.operation_id=o.id AND x.market_key='h2h'
                   ORDER BY x.period_end DESC LIMIT 1) bp ON true
LEFT JOIN LATERAL (SELECT x.target_url FROM operation_link x
                   WHERE x.operation_id=o.id AND x.is_active AND x.placement='default'
                   ORDER BY x.kind LIMIT 1) l ON true
WHERE o.status='active';
