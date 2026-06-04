'use strict';

// ── Mocks (hoisted before any require) ────────────────────────────────────────

jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash:    jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign:   jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
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

const { query }     = require('../config/database');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const { sendMail }  = require('../shared/mailer');
const AppError      = require('../shared/AppError');

const {
  login,
  refresh,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
} = require('../modules/auth/auth.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockUser = {
  user_id:             'user-uuid-1',
  company_id:          'company-uuid-1',
  password_hash:       '$2a$10$hashedpassword',
  is_active:           true,
  first_name:          'John',
  last_name:           'Doe',
  role_name:           'cashier',
  subscription_status: 'active',
};

// Sets up the standard successful login query sequence:
// 1. find user  2. update last_login  3. branches  4. plan  5. insert session
function setupLoginMocks(userOverride = {}) {
  const user = { ...mockUser, ...userOverride };
  query
    .mockResolvedValueOnce({ rows: [user] })                              // find user
    .mockResolvedValueOnce({ rows: [] })                                  // update last_login
    .mockResolvedValueOnce({ rows: [{ branch_id: 'branch-1' }] })        // branches
    .mockResolvedValueOnce({ rows: [{ has_finance: false, has_api_access: false }] }) // plan
    .mockResolvedValueOnce({ rows: [] });                                 // insert session
  bcrypt.compare.mockResolvedValueOnce(true);
}

// ── login ──────────────────────────────────────────────────────────────────────

describe('login', () => {
  test('returns tokens and user on valid credentials', async () => {
    setupLoginMocks();

    const result = await login({ email: 'john@example.com', password: 'password123' });

    expect(result).toMatchObject({
      accessToken:  'mock.jwt.token',
      refreshToken: 'mock.jwt.token',
      user: {
        userId:    mockUser.user_id,
        firstName: mockUser.first_name,
        lastName:  mockUser.last_name,
        role:      mockUser.role_name,
        companyId: mockUser.company_id,
        branchIds: ['branch-1'],
        planFeatures: { hasFinance: false, hasApiAccess: false },
      },
    });
  });

  test('throws INVALID_CREDENTIALS when email not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(login({ email: 'nobody@example.com', password: 'pass' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('throws ACCOUNT_INACTIVE when account is deactivated', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockUser, is_active: false }] });

    await expect(login({ email: 'john@example.com', password: 'pass' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_INACTIVE' });
  });

  test('throws SUBSCRIPTION_EXPIRED when subscription is suspended', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockUser, subscription_status: 'suspended' }] });

    await expect(login({ email: 'john@example.com', password: 'pass' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'SUBSCRIPTION_EXPIRED' });
  });

  test('throws ACCOUNT_CANCELLED when subscription is cancelled', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockUser, subscription_status: 'cancelled' }] });

    await expect(login({ email: 'john@example.com', password: 'pass' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_CANCELLED' });
  });

  test('throws INVALID_CREDENTIALS on wrong password', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] });
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(login({ email: 'john@example.com', password: 'wrongpass' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('super_admin gets full planFeatures regardless of plan row', async () => {
    const adminUser = { ...mockUser, role_name: 'super_admin', company_id: null };
    query
      .mockResolvedValueOnce({ rows: [adminUser] })
      .mockResolvedValueOnce({ rows: [] })                        // last_login
      .mockResolvedValueOnce({ rows: [] })                        // branches (empty)
      // no plan query — company_id is null
      .mockResolvedValueOnce({ rows: [] });                       // session insert
    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login({ email: 'admin@statify.co.ke', password: 'pass' });

    expect(result.user.planFeatures).toEqual({ hasFinance: true, hasApiAccess: true });
  });

  test('normalises email to lowercase before lookup', async () => {
    setupLoginMocks();
    await login({ email: '  JOHN@EXAMPLE.COM  ', password: 'pass' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE u.email = $1'),
      ['john@example.com']
    );
  });
});

// ── forgotPassword ─────────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  test('returns silently when email not found (prevents enumeration)', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    // Must NOT throw — that was Issue 2
    await expect(forgotPassword({ email: 'nobody@example.com' }))
      .resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('sends reset email when email exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', first_name: 'Jane' }] })
      .mockResolvedValueOnce({ rows: [] })   // expire old tokens
      .mockResolvedValueOnce({ rows: [] });  // insert new token

    await forgotPassword({ email: 'jane@example.com' });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to:      'jane@example.com',
        subject: expect.stringContaining('Reset'),
      })
    );
  });

  test('reset link in email contains a raw token', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', first_name: 'Jane' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await forgotPassword({ email: 'jane@example.com' });

    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('/reset-password?token=');
    // Token should be a 64-char hex string (32 random bytes)
    expect(html).toMatch(/token=[a-f0-9]{64}/);
  });
});

// ── resetPassword ──────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  test('throws INVALID_RESET_TOKEN when token not found or expired', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(resetPassword({ token: 'badtoken', newPassword: 'NewPass123' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RESET_TOKEN' });
  });

  test('updates password and revokes sessions on valid token', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ token_id: 'tok-1', user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] })   // update password
      .mockResolvedValueOnce({ rows: [] })   // mark token used
      .mockResolvedValueOnce({ rows: [] });  // revoke sessions
    bcrypt.hash.mockResolvedValueOnce('$2a$10$newhash');

    await expect(resetPassword({ token: 'validtoken', newPassword: 'NewPass123' }))
      .resolves.toBeUndefined();

    // Verify all 4 queries ran
    expect(query).toHaveBeenCalledTimes(4);
  });

  test('throws when password is shorter than 8 characters', async () => {
    await expect(resetPassword({ token: 'tok', newPassword: 'short' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws when token or newPassword is missing', async () => {
    await expect(resetPassword({ token: '', newPassword: 'password123' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(resetPassword({ token: 'tok', newPassword: '' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── refresh ────────────────────────────────────────────────────────────────────

describe('refresh', () => {
  test('throws when no token provided', async () => {
    await expect(refresh(undefined))
      .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_REFRESH_TOKEN' });
  });

  test('throws INVALID_REFRESH_TOKEN when jwt.verify fails', async () => {
    jwt.verify.mockImplementationOnce(() => { throw new Error('expired'); });

    await expect(refresh('bad.token'))
      .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_REFRESH_TOKEN' });
  });

  test('throws SESSION_REVOKED when session not found in DB', async () => {
    jwt.verify.mockReturnValueOnce({ userId: 'user-1' });
    query.mockResolvedValueOnce({ rows: [] }); // session lookup → empty

    await expect(refresh('valid.token'))
      .rejects.toMatchObject({ statusCode: 401, code: 'SESSION_REVOKED' });
  });

  test('returns new accessToken on valid session', async () => {
    jwt.verify.mockReturnValueOnce({ userId: 'user-1' });
    query
      .mockResolvedValueOnce({ rows: [{ session_id: 'sess-1' }] }) // session found
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', company_id: 'co-1', is_active: true, role_name: 'cashier' }] }) // user
      .mockResolvedValueOnce({ rows: [] })  // branches
      .mockResolvedValueOnce({ rows: [{ has_finance: false, has_api_access: false }] }); // plan

    const result = await refresh('valid.token');
    expect(result).toHaveProperty('accessToken', 'mock.jwt.token');
  });

  test('throws USER_INACTIVE when user is deactivated', async () => {
    jwt.verify.mockReturnValueOnce({ userId: 'user-1' });
    query
      .mockResolvedValueOnce({ rows: [{ session_id: 'sess-1' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', is_active: false }] });

    await expect(refresh('valid.token'))
      .rejects.toMatchObject({ statusCode: 401, code: 'USER_INACTIVE' });
  });
});

// ── logout ─────────────────────────────────────────────────────────────────────

describe('logout', () => {
  test('revokes the session in DB', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await logout('some.refresh.token');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('revoked_at = now()'),
      expect.any(Array)
    );
  });

  test('returns without error when no token provided', async () => {
    await expect(logout(undefined)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});

// ── changePassword ─────────────────────────────────────────────────────────────

describe('changePassword', () => {
  test('throws WRONG_PASSWORD when current password is incorrect', async () => {
    query.mockResolvedValueOnce({ rows: [{ password_hash: '$2a$10$hash' }] });
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(changePassword('user-1', { currentPassword: 'wrong', newPassword: 'NewPass123' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'WRONG_PASSWORD' });
  });

  test('updates password and revokes all sessions on success', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ password_hash: '$2a$10$hash' }] })
      .mockResolvedValueOnce({ rows: [] })   // update password
      .mockResolvedValueOnce({ rows: [] });  // revoke sessions
    bcrypt.compare.mockResolvedValueOnce(true);
    bcrypt.hash.mockResolvedValueOnce('$2a$10$newhash');

    await expect(changePassword('user-1', { currentPassword: 'correct', newPassword: 'NewPass123' }))
      .resolves.toBeUndefined();

    // Revoke sessions query should mention password_change
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("revoked_reason = 'password_change'"),
      expect.any(Array)
    );
  });

  test('throws notFound when user does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(changePassword('ghost-id', { currentPassword: 'x', newPassword: 'NewPass123' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
