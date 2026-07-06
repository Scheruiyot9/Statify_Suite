'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../modules/journal/journal.service', () => ({
  postCreditReceiptEntry: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { transaction } = require('../config/database');
const jrn = require('../modules/journal/journal.service');
const { recordCreditPayment } = require('../modules/customers/customers.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeClient(queryQueue = []) {
  let call = 0;
  return { query: jest.fn(() => Promise.resolve(queryQueue[call++] ?? { rows: [] })) };
}

function setupTransaction(client) {
  transaction.mockImplementationOnce((fn) => fn(client));
}

// ── recordCreditPayment ──────────────────────────────────────────────────────

describe('recordCreditPayment', () => {
  beforeEach(() => jrn.postCreditReceiptEntry.mockClear());

  test('throws when amount is not positive', async () => {
    await expect(recordCreditPayment('co-1', 'c-1', 0, null))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(recordCreditPayment('co-1', 'c-1', -5, null))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects overpayment when pos_allow_overpayment is disabled', async () => {
    const client = makeClient([
      { rows: [{ credit_balance: 100, customer_name: 'Alex' }] }, // current balance owed
      { rows: [{ pos_allow_overpayment: false }] },               // setting disabled
    ]);
    setupTransaction(client);

    await expect(recordCreditPayment('co-1', 'c-1', 150, null))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('allows a normal paydown (amount <= balance) without checking the overpayment setting', async () => {
    const client = makeClient([
      { rows: [{ credit_balance: 100, customer_name: 'Alex' }] },
      { rows: [{ customer_id: 'c-1', customer_name: 'Alex', credit_balance: 20, credit_limit: 500 }] }, // update result
      { rows: [] }, // outstanding transactions query
    ]);
    setupTransaction(client);

    const result = await recordCreditPayment('co-1', 'c-1', 80, null);

    expect(result.advance_credit).toBe(0);
    expect(result.credit_balance).toBe(20);
    // Only 3 queries — no company settings lookup, since this never overpays
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(jrn.postCreditReceiptEntry).toHaveBeenCalledTimes(1);
  });

  test('allows overpayment when enabled and records a customer_topups audit row', async () => {
    const client = makeClient([
      { rows: [{ credit_balance: 100, customer_name: 'Alex' }] },
      { rows: [{ pos_allow_overpayment: true }] },
      { rows: [{ customer_id: 'c-1', customer_name: 'Alex', credit_balance: -50, credit_limit: 500 }] },
      { rows: [] }, // outstanding transactions
      { rows: [] }, // backstop sweep (newBalance -50 <= 0)
      { rows: [{}] }, // customer_topups insert
    ]);
    setupTransaction(client);

    const result = await recordCreditPayment('co-1', 'c-1', 150, 'pm-1', 'sess-1', null, 'branch-1', 'user-1');

    expect(result.advance_credit).toBe(50);
    expect(result.credit_balance).toBe(-50);

    const topupCall = client.query.mock.calls[5];
    expect(topupCall[1]).toEqual(['co-1', 'branch-1', 'sess-1', 'c-1', 150, 'pm-1', 'user-1']);
  });

  test('sweeps stale partial/unpaid invoices when a payment brings the balance back to zero or below', async () => {
    // Reproduces: customer already has an advance credit balance (-145) from an earlier
    // overpayment, but an older invoice is still incorrectly flagged 'partial' (e.g. from
    // historical drift). A further payment that pushes the balance more negative should
    // still clear that stale invoice, even though there's no "real debt" left to FIFO against.
    const client = makeClient([
      { rows: [{ credit_balance: -145, customer_name: 'Alex' }] },
      { rows: [{ pos_allow_overpayment: true }] },
      { rows: [{ customer_id: 'c-1', customer_name: 'Alex', credit_balance: -425, credit_limit: 1000 }] },
      { rows: [{ transaction_id: 't-39', total_amount: 280 }] }, // stale 'partial' invoice
      { rows: [] }, // backstop sweep UPDATE
    ]);
    setupTransaction(client);

    const result = await recordCreditPayment('co-1', 'c-1', 280, null);

    expect(result.credit_balance).toBe(-425);
    // The backstop sweep (broad UPDATE keyed only on customerId, not a specific transaction_id)
    const sweepCall = client.query.mock.calls[4];
    expect(sweepCall[0]).toMatch(/UPDATE sales_transactions/);
    expect(sweepCall[1]).toEqual(['c-1']);
  });

  test('spending an existing negative balance further still counts as overpayment (advance credit grows)', async () => {
    const client = makeClient([
      { rows: [{ credit_balance: -300, customer_name: 'Alex' }] }, // already has advance credit
      { rows: [{ pos_allow_overpayment: true }] },
      { rows: [{ customer_id: 'c-1', customer_name: 'Alex', credit_balance: -500, credit_limit: 500 }] },
      { rows: [] },
    ]);
    setupTransaction(client);

    const result = await recordCreditPayment('co-1', 'c-1', 200, null);

    // advanceCredit = amount - currentBalance = 200 - (-300) = 500
    expect(result.advance_credit).toBe(500);
  });

  test('does not insert a customer_topups row when no userId is provided (backward compatible)', async () => {
    const client = makeClient([
      { rows: [{ credit_balance: 100, customer_name: 'Alex' }] },
      { rows: [{ customer_id: 'c-1', customer_name: 'Alex', credit_balance: 20, credit_limit: 500 }] },
      { rows: [] },
    ]);
    setupTransaction(client);

    await recordCreditPayment('co-1', 'c-1', 80, null);

    expect(client.query).toHaveBeenCalledTimes(3);
  });
});
