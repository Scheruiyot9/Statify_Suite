-- Migration: per-company session lifetime (refresh token expiry)
-- Default 7 days matches existing behaviour — no disruption to live sessions.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS session_lifetime_days INTEGER DEFAULT 7;

COMMENT ON COLUMN companies.session_lifetime_days IS
  'How many days a refresh token stays valid for this company. NULL falls back to the server default (JWT_REFRESH_EXPIRES_IN).';
