'use strict';

// rbac.middleware.js has no DB dependency — no mocks needed for most tests
// It imports roles.js (pure functions) and AppError (pure class)

const {
  requireRole,
  requirePermission,
  requireAnyPermission,
  requireBranchAccess,
  requireFinance,
  ROLE_RANK,
} = require('../middleware/rbac.middleware');

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockReq(userOverrides = {}) {
  return {
    user: {
      userId:    'user-1',
      role:      'cashier',
      companyId: 'co-1',
      branchIds: ['branch-1'],
      planFeatures: { hasFinance: false, hasApiAccess: false },
      ...userOverrides,
    },
    params: {},
    body:   {},
  };
}

const mockRes  = {};
const mockNext = jest.fn();

beforeEach(() => {
  mockNext.mockClear();
});

// ── requireRole ────────────────────────────────────────────────────────────────

describe('requireRole', () => {
  test('passes when user role exactly matches required role', () => {
    const req = mockReq({ role: 'cashier' });
    requireRole('cashier')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(/* no error */);
    expect(mockNext.mock.calls[0]).toHaveLength(0);
  });

  test('passes when user rank is higher than required (super_admin can do company_admin things)', () => {
    const req = mockReq({ role: 'super_admin' });
    requireRole('company_admin')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('passes when any of multiple allowed roles matches', () => {
    const req = mockReq({ role: 'branch_manager' });
    requireRole('cashier', 'branch_manager')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('throws 403 when role rank is insufficient', () => {
    const req = mockReq({ role: 'cashier' });
    expect(() => requireRole('company_admin')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  test('throws 401 when req.user is missing', () => {
    const req = { user: null, params: {}, body: {} };
    expect(() => requireRole('cashier')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  test('throws 403 for unknown role (rank 0 fails any real requirement)', () => {
    const req = mockReq({ role: 'unknown_role' });
    expect(() => requireRole('cashier')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

// ── ROLE_RANK sanity ───────────────────────────────────────────────────────────

describe('ROLE_RANK', () => {
  test('super_admin has highest rank', () => {
    const ranks = Object.values(ROLE_RANK);
    expect(ROLE_RANK.super_admin).toBe(Math.max(...ranks));
  });

  test('sales_staff has lowest rank', () => {
    const ranks = Object.values(ROLE_RANK);
    expect(ROLE_RANK.sales_staff).toBe(Math.min(...ranks));
  });

  test('company_admin outranks branch_manager', () => {
    expect(ROLE_RANK.company_admin).toBeGreaterThan(ROLE_RANK.branch_manager);
  });
});

// ── requirePermission ──────────────────────────────────────────────────────────

describe('requirePermission', () => {
  test('super_admin bypasses permission check entirely', () => {
    const req = mockReq({ role: 'super_admin' });
    requirePermission('manage_users')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('passes when role has the required permission', () => {
    const req = mockReq({ role: 'company_admin' });
    requirePermission('manage_users')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('throws 403 when role lacks the required permission', () => {
    const req = mockReq({ role: 'cashier' });
    expect(() => requirePermission('manage_users')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  test('cashier can open_pos_session', () => {
    const req = mockReq({ role: 'cashier' });
    requirePermission('open_pos_session')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('sales_staff cannot open_pos_session', () => {
    const req = mockReq({ role: 'sales_staff' });
    expect(() => requirePermission('open_pos_session')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

// ── requireAnyPermission ───────────────────────────────────────────────────────

describe('requireAnyPermission', () => {
  test('passes when user has at least one of the listed permissions', () => {
    const req = mockReq({ role: 'cashier' }); // cashier has view_products
    requireAnyPermission('manage_users', 'view_products')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('throws 403 when user has none of the listed permissions', () => {
    const req = mockReq({ role: 'sales_staff' }); // only view_products, view_customers
    expect(() => requireAnyPermission('manage_users', 'adjust_stock')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  test('super_admin always passes', () => {
    const req = mockReq({ role: 'super_admin' });
    requireAnyPermission('any_made_up_permission')(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });
});

// ── requireBranchAccess ────────────────────────────────────────────────────────

describe('requireBranchAccess', () => {
  test('company-wide roles bypass branch restriction', () => {
    for (const role of ['super_admin', 'company_admin', 'accountant', 'inventory_manager']) {
      mockNext.mockClear();
      const req = mockReq({ role, branchIds: [] });
      req.params.branchId = 'some-other-branch';
      requireBranchAccess()(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    }
  });

  test('passes when branch-scoped user accesses their assigned branch', () => {
    const req = mockReq({ role: 'cashier', branchIds: ['branch-1', 'branch-2'] });
    req.params.branchId = 'branch-1';
    requireBranchAccess()(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('throws 403 when branch-scoped user accesses unassigned branch', () => {
    const req = mockReq({ role: 'cashier', branchIds: ['branch-1'] });
    req.params.branchId = 'branch-99';
    expect(() => requireBranchAccess()(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  test('passes when no target branch param is provided', () => {
    const req = mockReq({ role: 'cashier', branchIds: ['branch-1'] });
    // no req.params.branchId set
    requireBranchAccess()(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('uses custom param name when specified', () => {
    const req = mockReq({ role: 'cashier', branchIds: ['branch-1'] });
    req.params.bid = 'branch-99';
    expect(() => requireBranchAccess('bid')(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

// ── requireFinance ─────────────────────────────────────────────────────────────

describe('requireFinance', () => {
  test('super_admin bypasses finance gate', () => {
    const req = mockReq({ role: 'super_admin', planFeatures: { hasFinance: false } });
    requireFinance(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('passes when planFeatures.hasFinance is true', () => {
    const req = mockReq({ role: 'company_admin', planFeatures: { hasFinance: true } });
    requireFinance(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('throws FINANCE_REQUIRED when plan lacks finance module', () => {
    const req = mockReq({ role: 'company_admin', planFeatures: { hasFinance: false } });
    expect(() => requireFinance(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'FINANCE_REQUIRED' }));
  });

  test('throws when planFeatures is missing entirely', () => {
    const req = mockReq({ role: 'cashier' });
    delete req.user.planFeatures;
    expect(() => requireFinance(req, mockRes, mockNext))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});
