'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../modules/journal/journal.service', () => ({
  postSaleEntry:          jest.fn().mockResolvedValue(undefined),
  postCreditReceiptEntry: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../modules/inventory/movements.service', () => ({
  recordMovement: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { query, transaction } = require('../config/database');
const jrn = require('../modules/journal/journal.service');
const { createTransaction } = require('../modules/sales/sales.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeClient(queryQueue = []) {
  let call = 0;
  return { query: jest.fn(() => Promise.resolve(queryQueue[call++] ?? { rows: [] })) };
}

function setupTransaction(client) {
  transaction.mockImplementationOnce((fn) => fn(client));
}

// Mocks the two module-level `query()` calls createTransaction always makes before
// entering the DB transaction: the credit_sales_enabled check (only if isCreditSale)
// and the pos_prevent_sales_below_cost/costing_method/journal_posting_mode lookup.
function mockPreTransactionQueries({ isCreditSale = false, creditSalesEnabled = true } = {}) {
  query.mockReset();
  if (isCreditSale) {
    query.mockResolvedValueOnce({ rows: [{ credit_sales_enabled: creditSalesEnabled }] });
  }
  query.mockResolvedValueOnce({
    rows: [{ pos_prevent_sales_below_cost: false, costing_method: 'weighted_average', journal_posting_mode: 'per_transaction' }],
  });
}

const oneItem = [{ productId: 'p-1', quantity: 1, unitPrice: 500, discount: 0, taxAmount: 0, lineTotal: 500 }];

// ── createTransaction ────────────────────────────────────────────────────────

describe('createTransaction', () => {
  beforeEach(() => {
    jrn.postSaleEntry.mockClear();
    jrn.postCreditReceiptEntry.mockClear();
  });

  test('partial credit sale: some payment now, remainder posts to credit_balance', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },                                                     // txn counter
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },                       // loyalty rates
      { rows: [{ allow_credit: true, credit_limit: 1000, credit_balance: 0 }] },           // credit check
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'partial' }] }, // insert txn
      { rows: [{ quantity_available: 100 }] },                                            // stock check
      { rows: [{}] },                                                                      // insert item
      { rows: [{}] },                                                                      // update inventory
      { rows: [{}] },                                                                      // insert transaction_payments
      { rows: [{}] },                                                                      // update credit_balance
      { rowCount: 1, rows: [] },                                                           // loyalty points
    ]);
    setupTransaction(client);

    const result = await createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [{ paymentMethodId: 'pm-1', amountApplied: 200, amountTendered: 200 }],
      isCreditSale: true,
    });

    expect(result.transaction_id).toBe('t-1');

    // arPortion (500 - 200 = 300) is what should be added to credit_balance
    const creditUpdateCall = client.query.mock.calls[8];
    expect(creditUpdateCall[1]).toEqual(['c-1', 300]);

    // payment_status computed as 'partial' should be passed into the INSERT
    const insertTxnCall = client.query.mock.calls[3];
    expect(insertTxnCall[1][10]).toBe('partial');
  });

  test('spends down an existing negative balance (advance credit) without allow_credit', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ allow_credit: false, credit_limit: 0, credit_balance: -500 }] },          // existing advance credit, no allow_credit
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'paid' }] },
      { rows: [{ quantity_available: 100 }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] }, // update credit_balance (arPortion = 500, newBalance = 0, still <= 0 so no allow_credit gate)
      { rowCount: 1, rows: [] },
    ]);
    setupTransaction(client);

    const result = await createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [],
      isCreditSale: true,
    });

    expect(result.transaction_id).toBe('t-1');
    const creditUpdateCall = client.query.mock.calls[7];
    expect(creditUpdateCall[1]).toEqual(['c-1', 500]);

    // Fully absorbed by the pre-existing advance credit (newBalance lands at exactly 0) —
    // this invoice should read as 'paid', not 'partial', even though no cash was tendered.
    const insertTxnCall = client.query.mock.calls[3];
    expect(insertTxnCall[1][10]).toBe('paid');
  });

  test('marks a credit sale "paid" when an existing advance credit fully covers it, with room to spare', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ allow_credit: true, credit_limit: 1000, credit_balance: -700 }] }, // plenty of prepaid balance
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'paid' }] },
      { rows: [{ quantity_available: 100 }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] }, // update credit_balance (arPortion = 500, newBalance = -200, still <= 0)
      { rowCount: 1, rows: [] },
    ]);
    setupTransaction(client);

    await createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [],
      isCreditSale: true,
    });

    const insertTxnCall = client.query.mock.calls[3];
    expect(insertTxnCall[1][10]).toBe('paid');
  });

  test('marks a credit sale "partial" when advance credit only partly covers it and real debt remains', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ allow_credit: true, credit_limit: 1000, credit_balance: -200 }] }, // only partial prepaid coverage
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'partial' }] },
      { rows: [{ quantity_available: 100 }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] }, // update credit_balance (arPortion = 500, newBalance = 300, real debt created)
      { rowCount: 1, rows: [] },
    ]);
    setupTransaction(client);

    await createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [],
      isCreditSale: true,
    });

    const insertTxnCall = client.query.mock.calls[3];
    expect(insertTxnCall[1][10]).toBe('partial');
  });

  test('rejects a credit sale that would exceed the credit limit', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ allow_credit: true, credit_limit: 100, credit_balance: 0 }] },
    ]);
    setupTransaction(client);

    await expect(createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [],
      isCreditSale: true,
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a credit sale for a customer without allow_credit when it would create real debt', async () => {
    mockPreTransactionQueries({ isCreditSale: true });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ allow_credit: false, credit_limit: 0, credit_balance: 0 }] },
    ]);
    setupTransaction(client);

    await expect(createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [],
      isCreditSale: true,
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('banks a sale overpayment to the customer account when enabled', async () => {
    mockPreTransactionQueries({ isCreditSale: false });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'paid' }] },
      { rows: [{ quantity_available: 100 }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] },                                    // insert transaction_payments
      { rows: [{ pos_allow_overpayment: true }] },        // overpayment setting check
      { rows: [{ customer_name: 'Alex' }] },              // customer name lookup
      { rows: [{}] },                                     // update credit_balance (bank excess)
      { rowCount: 1, rows: [] },
    ]);
    setupTransaction(client);

    const result = await createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [{ paymentMethodId: 'pm-1', amountApplied: 500, amountTendered: 500 }],
      bankOverpaymentToCustomer: true,
      overpaymentAmount: 50,
      overpaymentPaymentMethodId: 'pm-1',
    });

    expect(result.transaction_id).toBe('t-1');
    expect(jrn.postCreditReceiptEntry).toHaveBeenCalledWith(client, 'co-1', expect.objectContaining({
      customerId: 'c-1', customerName: 'Alex', amount: 50, paymentMethodId: 'pm-1',
    }));
    const balanceUpdateCall = client.query.mock.calls[9];
    expect(balanceUpdateCall[1]).toEqual(['c-1', 50]);
  });

  test('rejects overpayment banking when the company setting is disabled', async () => {
    mockPreTransactionQueries({ isCreditSale: false });
    const client = makeClient([
      { rows: [{ txn_counter: 1 }] },
      { rows: [{ points_earn_rate: 10, points_redeem_rate: 0.1 }] },
      { rows: [{ transaction_id: 't-1', transaction_number: 'TXN-1', transaction_date: new Date(), total_amount: 500, payment_status: 'paid' }] },
      { rows: [{ quantity_available: 100 }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ pos_allow_overpayment: false }] },
    ]);
    setupTransaction(client);

    await expect(createTransaction('co-1', 'b-1', 'u-1', {
      customerId: 'c-1',
      items: oneItem,
      payments: [{ paymentMethodId: 'pm-1', amountApplied: 500, amountTendered: 500 }],
      bankOverpaymentToCustomer: true,
      overpaymentAmount: 50,
      overpaymentPaymentMethodId: 'pm-1',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
