'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../shared/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { transaction } = require('../config/database');
const { sendMail }    = require('../shared/mailer');
const { adjustStock } = require('../modules/inventory/inventory.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_ROW = {
  quantity_available: '10',
  reorder_level:      '5',
  product_name:       'Widget',
  sku:                'WG-001',
  branch_name:        'Main Branch',
  contact_email:      'owner@acme.com',
  company_name:       'Acme Ltd',
};

function makeClient(rows) {
  // adjustStock: SELECT (FOR UPDATE) then UPDATE
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows })          // SELECT
      .mockResolvedValueOnce({ rows: [] }),     // UPDATE
  };
  return client;
}

function setupTransaction(client) {
  transaction.mockImplementationOnce((fn) => fn(client));
}

// ── adjustStock ────────────────────────────────────────────────────────────────

describe('adjustStock', () => {
  test('throws 400 when product_id is missing', async () => {
    await expect(adjustStock('co-1', 'user-1', { branch_id: 'b-1', adjustment: 5 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when branch_id is missing', async () => {
    await expect(adjustStock('co-1', 'user-1', { product_id: 'p-1', adjustment: 5 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when adjustment is zero', async () => {
    await expect(adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: 0 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 404 when inventory record not found', async () => {
    setupTransaction(makeClient([]));

    await expect(adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: 5 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 422 when adjustment would reduce stock below zero', async () => {
    setupTransaction(makeClient([{ ...BASE_ROW, quantity_available: '3' }]));

    await expect(adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -5 }))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  test('returns correct before/after quantities on positive adjustment', async () => {
    setupTransaction(makeClient([BASE_ROW]));

    const result = await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: 3 });

    expect(result.quantity_before).toBe(10);
    expect(result.quantity_after).toBe(13);
    expect(result.adjustment).toBe(3);
    expect(result.product_name).toBe('Widget');
  });

  test('returns correct before/after on negative adjustment without crossing zero', async () => {
    setupTransaction(makeClient([BASE_ROW]));

    const result = await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -4 });

    expect(result.quantity_before).toBe(10);
    expect(result.quantity_after).toBe(6);
  });

  // ── Low-stock alert behaviour ─────────────────────────────────────────────────

  test('fires low-stock alert when new qty reaches exactly reorder_level', async () => {
    // stock 10 → -5 → 5 which equals reorder_level 5
    setupTransaction(makeClient([BASE_ROW]));

    await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -5 });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to:      'owner@acme.com',
      subject: expect.stringContaining('Widget'),
    }));
  });

  test('fires low-stock alert when new qty drops below reorder_level', async () => {
    // stock 10 → -7 → 3 which is below reorder_level 5
    setupTransaction(makeClient([BASE_ROW]));

    await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -7 });

    expect(sendMail).toHaveBeenCalled();
  });

  test('does NOT fire alert when new qty stays above reorder_level', async () => {
    // stock 10 → -3 → 7 which is above reorder_level 5
    setupTransaction(makeClient([BASE_ROW]));

    await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -3 });

    expect(sendMail).not.toHaveBeenCalled();
  });

  test('does NOT fire alert when reorder_level is 0', async () => {
    setupTransaction(makeClient([{ ...BASE_ROW, reorder_level: '0' }]));

    await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -9 });

    expect(sendMail).not.toHaveBeenCalled();
  });

  test('does NOT fire alert when contact_email is absent', async () => {
    setupTransaction(makeClient([{ ...BASE_ROW, contact_email: null }]));

    await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -7 });

    expect(sendMail).not.toHaveBeenCalled();
  });

  test('stock adjustment still succeeds when sendMail rejects', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    setupTransaction(makeClient([BASE_ROW]));

    // adjustment drops qty to 3 (below reorder 5) — should still resolve cleanly
    const result = await adjustStock('co-1', 'user-1', { product_id: 'p-1', branch_id: 'b-1', adjustment: -7 });

    expect(result.quantity_after).toBe(3);
  });
});
