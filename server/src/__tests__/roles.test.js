'use strict';

// roles.js is a pure module — no mocks needed
const {
  COMPANY_WIDE_ROLES,
  ROLE_PERMISSIONS,
  permissionsForRole,
  isCompanyWide,
  branchScope,
  resolveBranchId,
} = require('../shared/roles');

// ── permissionsForRole ─────────────────────────────────────────────────────────

describe('permissionsForRole', () => {
  test('returns empty array for unknown role', () => {
    expect(permissionsForRole('unknown')).toEqual([]);
  });

  test('super_admin has manage_users', () => {
    expect(permissionsForRole('super_admin')).toContain('manage_users');
  });

  test('cashier does NOT have manage_users', () => {
    expect(permissionsForRole('cashier')).not.toContain('manage_users');
  });

  test('cashier has open_pos_session', () => {
    expect(permissionsForRole('cashier')).toContain('open_pos_session');
  });

  test('accountant can view_reports', () => {
    const perms = permissionsForRole('accountant');
    expect(perms).toContain('view_reports');
  });

  test('branch_manager has open_pos_session', () => {
    const perms = permissionsForRole('branch_manager');
    expect(perms).toContain('open_pos_session');
    expect(perms).not.toContain('manage_users');
  });

  test('all defined roles are present in ROLE_PERMISSIONS', () => {
    const expectedRoles = [
      'super_admin', 'company_admin', 'branch_manager',
      'accountant', 'cashier',
    ];
    expectedRoles.forEach((role) => {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
      expect(Array.isArray(permissionsForRole(role))).toBe(true);
    });
  });
});

// ── isCompanyWide / COMPANY_WIDE_ROLES ─────────────────────────────────────────

describe('isCompanyWide', () => {
  test('returns true for company-wide roles', () => {
    COMPANY_WIDE_ROLES.forEach((role) => {
      expect(isCompanyWide(role)).toBe(true);
    });
  });

  test('returns false for branch-scoped roles', () => {
    expect(isCompanyWide('cashier')).toBe(false);
    expect(isCompanyWide('branch_manager')).toBe(false);
  });

  test('returns false for unknown role', () => {
    expect(isCompanyWide('ghost')).toBe(false);
  });
});

// ── branchScope ────────────────────────────────────────────────────────────────

describe('branchScope', () => {
  test('company-wide role returns empty clause with companyId as first param', () => {
    const { clause, params } = branchScope('company_admin', 'co-1', [], 'st');
    expect(clause).toBe('');
    expect(params).toEqual(['co-1']);
  });

  test('branch-scoped role returns AND clause with branch array', () => {
    const { clause, params } = branchScope('cashier', 'co-1', ['b-1', 'b-2'], 'st');
    expect(clause).toContain('st.branch_id = ANY($2)');
    expect(params).toEqual(['co-1', ['b-1', 'b-2']]);
  });

  test('branch-scoped role with empty branchIds uses sentinel UUID to return nothing', () => {
    const { clause, params } = branchScope('cashier', 'co-1', [], 'st');
    expect(clause).toContain('st.branch_id = ANY($2)');
    // Sentinel UUID prevents accidental full-table access
    expect(params[1]).toHaveLength(1);
    expect(params[1][0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('uses custom table alias in generated clause', () => {
    const { clause } = branchScope('cashier', 'co-1', ['b-1'], 'txn');
    expect(clause).toContain('txn.branch_id = ANY($2)');
  });
});

// ── resolveBranchId ────────────────────────────────────────────────────────────

describe('resolveBranchId', () => {
  function mockReq(overrides = {}) {
    return {
      user:  { role: 'cashier', branchIds: ['branch-1', 'branch-2'], ...overrides.user },
      query: overrides.query || {},
      body:  overrides.body  || {},
    };
  }

  test('returns branchId from query string', () => {
    const req = mockReq({ query: { branchId: 'branch-1' } });
    expect(resolveBranchId(req)).toBe('branch-1');
  });

  test('returns branchId from body', () => {
    const req = mockReq({ body: { branchId: 'branch-2' } });
    expect(resolveBranchId(req)).toBe('branch-2');
  });

  test('falls back to first assigned branch when not in query/body', () => {
    const req = mockReq();
    expect(resolveBranchId(req)).toBe('branch-1');
  });

  test('throws when branchId not found and required=true (default)', () => {
    const req = mockReq({ user: { role: 'cashier', branchIds: [] } });
    expect(() => resolveBranchId(req)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('returns null when branchId not found and required=false', () => {
    const req = mockReq({ user: { role: 'cashier', branchIds: [] } });
    expect(resolveBranchId(req, { required: false })).toBeNull();
  });

  test('throws 403 when non-company-wide user requests unassigned branch', () => {
    const req = mockReq({ query: { branchId: 'branch-99' } });
    expect(() => resolveBranchId(req))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  test('company-wide role can resolve any branch', () => {
    const req = mockReq({
      user:  { role: 'company_admin', branchIds: [] },
      query: { branchId: 'any-branch-uuid' },
    });
    expect(resolveBranchId(req)).toBe('any-branch-uuid');
  });
});
