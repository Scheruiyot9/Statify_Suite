const { Router }    = require('express');
const rateLimit     = require('express-rate-limit');
const Joi           = require('joi');
const controller    = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate }  = require('../../shared/validators/common.validators');

const router = Router();

// Strict rate limit on login to slow brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// Moderate rate limit on refresh — prevents token probing without breaking normal use
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many refresh attempts. Try again shortly.' },
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     Joi.string().min(8).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token:       Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

const interestSchema = Joi.object({
  fullName:     Joi.string().min(2).max(150).required(),
  email:        Joi.string().email().required(),
  phone:        Joi.string().max(30).allow('', null).optional(),
  businessName: Joi.string().min(2).max(150).required(),
  message:      Joi.string().max(1000).allow('', null).optional(),
});

// Moderate rate limit for password reset requests
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many password reset requests. Try again in 15 minutes.' },
});

// Public
router.post('/login',           loginLimiter,   validate(loginSchema),          controller.login);
router.post('/refresh',         refreshLimiter, controller.refresh);
router.post('/forgot-password', forgotLimiter,  validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password',  forgotLimiter,  validate(resetPasswordSchema),  controller.resetPassword);
router.post('/interest',                        validate(interestSchema),        controller.submitInterest);

const pinHashSchema = Joi.object({
  pinHash: Joi.string().length(64).pattern(/^[0-9a-f]+$/).required(),
});

// Protected
router.post('/logout',           authenticate, controller.logout);
router.get('/me',                authenticate, controller.me);
router.patch('/change-password', authenticate, validate(changePasswordSchema), controller.changePassword);
router.post('/set-pin',          authenticate, validate(pinHashSchema),          controller.setPin);
router.post('/verify-pin',       authenticate, validate(pinHashSchema),          controller.verifyPin);

module.exports = router;
