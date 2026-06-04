'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { transaction } = require('../config/database');
const { bulkImportProducts } = require('../modules/products/products.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeClient(queryQueue = []) {
  let call = 0;
  return { query: jest.fn(() => Promise.resolve(queryQueue[call++] ?? { rows: [] })) };
}

function setupTransaction(client) {
  transaction.mockImplementationOnce((fn) => fn(client));
}

const validRow = {
  product_name:    'Test Widget',
  sku:             'TW-001',
  barcode:         '1234567890',
  base_price:      '9.99',
  cost_price:      '4.50',
  unit_of_measure: 'Unit',
  description:     'A test product',
  category_name:   'Widgets',
  reorder_level:   '5',
  initial_stock:   '10',
};

// ── bulkImportProducts ─────────────────────────────────────────────────────────

describe('bulkImportProducts', () => {
  test('throws when called with an empty array', async () => {
    await expect(bulkImportProducts('co-1', []))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws when array exceeds 500 rows', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...validRow, sku: `SKU-${i}` }));
    await expect(bulkImportProducts('co-1', rows))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('successfully imports a single valid product', async () => {
    const client = makeClient([
      { rows: [] },                                            // categories
      { rows: [{ branch_id: 'b-1' }] },                       // branches
      { rows: [] },                                            // existing SKUs
      { rows: [{ product_id: 'p-1', product_name: 'Test Widget', sku: 'TW-001' }] }, // INSERT product
      { rows: [] },                                            // INSERT inventory
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [validRow]);

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({ success: true, row: 1 });
  });

  test('skips row with missing product_name', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [{ branch_id: 'b-1' }] }, { rows: [] },
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [{ ...validRow, product_name: '' }]);

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/product_name/i);
  });

  test('skips row with invalid base_price', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [{ branch_id: 'b-1' }] }, { rows: [] },
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [{ ...validRow, base_price: 'not-a-number' }]);

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/base_price/i);
  });

  test('skips row with negative base_price', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [{ branch_id: 'b-1' }] }, { rows: [] },
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [{ ...validRow, base_price: '-5' }]);

    expect(result.failed).toBe(1);
  });

  test('skips row when SKU already exists in DB', async () => {
    const client = makeClient([
      { rows: [] },                            // categories
      { rows: [{ branch_id: 'b-1' }] },       // branches
      { rows: [{ sku: 'TW-001' }] },           // existing SKUs — TW-001 already present
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [validRow]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/already exists/i);
  });

  test('prevents duplicate SKU within the same batch', async () => {
    const row1 = { ...validRow };
    const row2 = { ...validRow, product_name: 'Duplicate' };

    const client = makeClient([
      { rows: [] },                                            // categories
      { rows: [{ branch_id: 'b-1' }] },                       // branches
      { rows: [] },                                            // existing SKUs (empty)
      { rows: [{ product_id: 'p-1', product_name: 'Test Widget', sku: 'TW-001' }] }, // row1 INSERT
      { rows: [] },                                            // row1 inventory
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', [row1, row2]);

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[1].error).toMatch(/already exists/i);
  });

  test('resolves category_name to category_id when found', async () => {
    const client = makeClient([
      { rows: [{ category_id: 'cat-1', lname: 'widgets' }] }, // categories
      { rows: [{ branch_id: 'b-1' }] },
      { rows: [] },
      { rows: [{ product_id: 'p-1', product_name: 'Test Widget', sku: 'TW-001' }] },
      { rows: [] },
    ]);
    setupTransaction(client);

    await bulkImportProducts('co-1', [validRow]);

    // The INSERT call (4th query on client) should have 'cat-1' as 6th param
    const insertCall = client.query.mock.calls[3];
    expect(insertCall[1][5]).toBe('cat-1');
  });

  test('leaves category_id null when category_name not found', async () => {
    const client = makeClient([
      { rows: [] },  // categories — empty, so 'Widgets' won't match
      { rows: [{ branch_id: 'b-1' }] },
      { rows: [] },
      { rows: [{ product_id: 'p-1', product_name: 'Test Widget', sku: 'TW-001' }] },
      { rows: [] },
    ]);
    setupTransaction(client);

    await bulkImportProducts('co-1', [validRow]);

    const insertCall = client.query.mock.calls[3];
    expect(insertCall[1][5]).toBeNull();
  });

  test('reports correct counts across mixed valid/invalid rows', async () => {
    const rows = [
      validRow,
      { ...validRow, sku: 'TW-002', product_name: 'Second' },
      { ...validRow, product_name: '' },  // invalid
    ];

    const client = makeClient([
      { rows: [] }, { rows: [{ branch_id: 'b-1' }] }, { rows: [] },
      { rows: [{ product_id: 'p-1', product_name: 'Test Widget', sku: 'TW-001' }] }, { rows: [] },
      { rows: [{ product_id: 'p-2', product_name: 'Second', sku: 'TW-002' }] }, { rows: [] },
    ]);
    setupTransaction(client);

    const result = await bulkImportProducts('co-1', rows);

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);
  });
});
