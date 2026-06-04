const authService = require('./auth.service');
const env         = require('../../config/env');
const { ok }      = require('../../shared/response');

const COOKIE_NAME = 'rt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   env.nodeEnv === 'production',
  sameSite: 'lax',
  path:     '/api/v1/auth',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

const login = async (req, res) => {
  const result = await authService.login(req.body);
  // Send refresh token as httpOnly cookie; access token in body
  res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTS);
  ok(res, { accessToken: result.accessToken, user: result.user });
};

const refresh = async (req, res) => {
  const refreshToken = req.cookies?.[COOKIE_NAME];
  const result = await authService.refresh(refreshToken);
  ok(res, result);
};

const logout = async (req, res) => {
  const refreshToken = req.cookies?.[COOKIE_NAME];
  await authService.logout(refreshToken);
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  ok(res, { message: 'Logged out successfully' });
};

const me = async (req, res) => {
  const extra = await authService.getMe(req.user.userId, req.user.companyId);
  ok(res, { user: { ...req.user, ...extra } });
};

const changePassword = async (req, res) => {
  await authService.changePassword(req.user.userId, req.body);
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  ok(res, { message: 'Password updated successfully. Please log in again.' });
};

const forgotPassword = async (req, res) => {
  await authService.forgotPassword(req.body);
  // Always return 200 — never leak whether the email exists
  ok(res, { message: 'If that email is registered, you will receive a reset link shortly.' });
};

const resetPassword = async (req, res) => {
  await authService.resetPassword(req.body);
  ok(res, { message: 'Password reset successfully. You can now log in with your new password.' });
};

const submitInterest = async (req, res) => {
  await authService.submitInterest(req.body);
  ok(res, { message: 'Thank you! We will be in touch shortly.' });
};

const setPin = async (req, res) => {
  await authService.setPin(req.user.userId, req.body);
  ok(res, { message: 'PIN saved successfully' });
};

const verifyPin = async (req, res) => {
  const result = await authService.verifyPin(req.user.userId, req.body);
  ok(res, result);
};

module.exports = {
  login, refresh, logout, me, changePassword, forgotPassword, resetPassword,
  submitInterest, setPin, verifyPin,
};
