'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  query:       jest.fn(),
  transaction: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

const { transaction } = require('../config/database');
const { bulkImportProducts, bulkUpdateProducts } = require('../modules/products/products.service');

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

// ── bulkUpdateProducts ─────────────────────────────────────────────────────────

describe('bulkUpdateProducts', () => {
  test('throws when called with an empty array', async () => {
    await expect(bulkUpdateProducts('co-1', []))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws when array exceeds 500 rows', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ sku: `SKU-${i}`, base_price: '9.99' }));
    await expect(bulkUpdateProducts('co-1', rows))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('skips row with missing sku', async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ base_price: '9.99' }]);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/sku is required/i);
  });

  test('skips row when sku is not found', async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'MISSING', base_price: '9.99' }]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/not found/i);
  });

  test('skips row with no editable fields provided', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [] }, { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },
    ]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'TW-001' }]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/no fields/i);
  });

  test('successfully updates base_price for a matched sku', async () => {
    const client = makeClient([
      { rows: [] },                                             // categories
      { rows: [] },                                             // tax templates
      { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },        // existing products
      { rows: [{ product_id: 'p-1', sku: 'TW-001', product_name: 'Test Widget' }] }, // UPDATE
    ]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'TW-001', base_price: '19.99' }]);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0]).toMatchObject({ success: true, sku: 'TW-001' });
  });

  test('rejects invalid base_price', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [] }, { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },
    ]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'TW-001', base_price: 'oops' }]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/base_price/i);
  });

  test('rejects unknown category_name', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [] }, { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },
    ]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'TW-001', category_name: 'Nope' }]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/unknown category_name/i);
  });

  test('rejects invalid is_active value', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [] }, { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },
    ]);
    setupTransaction(client);

    const result = await bulkUpdateProducts('co-1', [{ sku: 'TW-001', is_active: 'maybe' }]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/is_active/i);
  });

  test('leaves unspecified fields unchanged via null params', async () => {
    const client = makeClient([
      { rows: [] }, { rows: [] },
      { rows: [{ product_id: 'p-1', sku: 'TW-001' }] },
      { rows: [{ product_id: 'p-1', sku: 'TW-001', product_name: 'Test Widget' }] },
    ]);
    setupTransaction(client);

    await bulkUpdateProducts('co-1', [{ sku: 'TW-001', base_price: '19.99' }]);

    const updateCall = client.query.mock.calls[3];
    // params: [companyId, productId, productName, barcode, description, unitOfMeasure, categoryId, taxTemplateId, basePrice, costPrice, isActive]
    expect(updateCall[1][2]).toBeNull();   // product_name untouched
    expect(updateCall[1][8]).toBe(19.99);  // base_price applied
  });
});
