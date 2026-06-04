-- Migration: add PIN lock support
-- pin_hash on users (SHA-256 of pin:userId, set client-side)
-- lock_timeout_minutes on companies (NULL = feature disabled)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS lock_timeout_minutes INTEGER DEFAULT NULL;

COMMENT ON COLUMN users.pin_hash IS
  'SHA-256 hex of (pin:userId). Used for terminal lock-screen unlock. NULL = PIN not set.';

COMMENT ON COLUMN companies.lock_timeout_minutes IS
  'Minutes of inactivity before the POS terminal locks. NULL = disabled.';
