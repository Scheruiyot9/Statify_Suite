-- Migration: subscription_requests table
-- Company admins submit a plan+period request; super-admin approves or rejects.
-- Safe to re-run — uses IF NOT EXISTS / constraint checks.

CREATE TABLE IF NOT EXISTS subscription_requests (
  request_id       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id       UUID NOT NULL REFERENCES companies(company_id)        ON DELETE CASCADE,
  plan_id          UUID NOT NULL REFERENCES subscription_plans(plan_id),
  period           VARCHAR(20)  NOT NULL,
  message          TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  actioned_by      UUID REFERENCES users(user_id),
  actioned_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_sub_request_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_sub_requests_company
  ON subscription_requests (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sub_requests_status
  ON subscription_requests (status, created_at DESC);
