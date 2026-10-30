-- 0001: extensions + enums
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_status   AS ENUM ('pending','active','suspended','revoked','banned');
CREATE TYPE availability  AS ENUM ('available','unavailable','until_ts');
CREATE TYPE vouch_status  AS ENUM ('requested','accepted','declined','unknown','expired','frozen');
CREATE TYPE mr_status     AS ENUM ('pending','under_review','approved','rejected','escalated');
CREATE TYPE inc_status    AS ENUM ('open','covered','resolved','resolved_unconfirmed','cancelled',
                                   'expired_unconfirmed','unresponsive','flagged');
CREATE TYPE resp_kind     AS ENUM ('coming','referred','cannot');
CREATE TYPE resp_status   AS ENUM ('en_route','arrived','withdrawn');
CREATE TYPE notif_channel AS ENUM ('push','sms','call');
CREATE TYPE strike_kind   AS ENUM ('accidental','mistaken','false');
CREATE TYPE ban_status    AS ENUM ('suspected','under_review','confirmed','dismissed');
CREATE TYPE cascade_status AS ENUM ('frozen','objection_window','banned','cleared');
CREATE TYPE dispute_status AS ENUM ('raised','decided','dismissed');

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
