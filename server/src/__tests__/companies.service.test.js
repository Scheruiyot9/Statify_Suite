'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../shared/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/env', () => ({
  jwt: {
    secret:           'test-secret',
    expiresIn:        '15m',
    refreshSecret:    'test-refresh-secret',
    refreshExpiresIn: '7d',
  },
  bcryptRounds: 1,
  appUrl: 'http://localhost:5173',
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { query }    = require('../config/database');
const { sendMail } = require('../shared/mailer');
const { getMySubscription, requestUpgrade } = require('../modules/companies/companies.service');

// ── getMySubscription ──────────────────────────────────────────────────────────

describe('getMySubscription', () => {
  const mockRow = {
    company_id:              'co-1',
    company_name:            'Acme Ltd',
    subscription_status:     'active',
    subscription_plan_id:    'plan-1',
    subscription_start_date: '2025-01-01',
    subscription_end_date:   '2026-01-01',
    plan_name:               'Pro',
    plan_price:              '29.99',
    annual_price:            '299.99',
    max_users:               10,
    max_branches:            3,
    trial_days:              14,
    has_finance:             true,
    has_api_access:          false,
    user_count:              '4',
    branch_count:            '2',
  };

  test('returns normalised subscription data for a known company', async () => {
    query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await getMySubscription('co-1');

    expect(result).toMatchObject({
      subscription_status:     'active',
      plan_name:               'Pro',
      plan_price:              29.99,
      annual_price:            299.99,
      has_finance:             true,
      has_api_access:          false,
      current_users:           4,
      current_branches:        2,
      subscription_start_date: '2025-01-01',
      subscription_end_date:   '2026-01-01',
    });
  });

  test('returns plan_name "None" when company has no plan', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockRow, plan_name: null, plan_price: null, annual_price: null }] });

    const result = await getMySubscription('co-1');

    expect(result.plan_name).toBe('None');
    expect(result.plan_price).toBe(0);
    expect(result.annual_price).toBe(0);
  });

  test('throws 404 when company does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getMySubscription('ghost-id'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('passes companyId correctly to the query', async () => {
    query.mockResolvedValueOnce({ rows: [mockRow] });

    await getMySubscription('co-1');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE c.company_id = $1'),
      ['co-1']
    );
  });
});

// ── requestUpgrade ─────────────────────────────────────────────────────────────

describe('requestUpgrade', () => {
  const companyRow = {
    company_name:  'Acme Ltd',
    contact_email: 'owner@acme.com',
    current_plan:  'Starter',
  };

  test('sends upgrade request email to support address', async () => {
    query.mockResolvedValueOnce({ rows: [companyRow] });

    await requestUpgrade('co-1', { planName: 'Pro', message: 'Need more features' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@statify.co.ke',
      subject: expect.stringContaining('Acme Ltd'),
    }));
  });

  test('email body includes company name, current plan, and requested plan', async () => {
    query.mockResolvedValueOnce({ rows: [companyRow] });

    await requestUpgrade('co-1', { planName: 'Enterprise', message: '' });

    const { html, text } = sendMail.mock.calls[0][0];
    expect(html).toContain('Acme Ltd');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Starter');
    expect(text).toContain('Enterprise');
  });

  test('throws 404 when company does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(requestUpgrade('ghost-id', { planName: 'Pro' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('handles null contact_email gracefully (still sends to support)', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...companyRow, contact_email: null }] });

    await requestUpgrade('co-1', { planName: 'Pro', message: '' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@statify.co.ke',
    }));
  });
});
