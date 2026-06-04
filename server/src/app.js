require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { errorHandler, notFound } = require('./middleware/error.middleware');

// Route modules
const authRoutes = require('./modules/auth/auth.routes');
const companiesRoutes = require('./modules/companies/companies.routes');
const branchesRoutes = require('./modules/branches/branches.routes');
const usersRoutes = require('./modules/users/users.routes');
const productsRoutes = require('./modules/products/products.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const customersRoutes = require('./modules/customers/customers.routes');
const salesRoutes = require('./modules/sales/sales.routes');
const returnsRoutes = require('./modules/returns/returns.routes');
const posRoutes = require('./modules/pos/pos.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const platformRoutes = require('./modules/platform/platform.routes');
const taxRoutes          = require('./modules/tax/tax.routes');
const mpesaRoutes        = require('./modules/mpesa/mpesa.routes');
const accountsRoutes     = require('./modules/accounts/accounts.routes');
const bankAccountsRoutes = require('./modules/bank-accounts/bank-accounts.routes');
const suppliersRoutes    = require('./modules/suppliers/suppliers.routes');
const purchasesRoutes    = require('./modules/purchases/purchases.routes');
const grnsRoutes         = require('./modules/purchases/grns.routes');
const paymentsRoutes     = require('./modules/payments/payments.routes');
const journalRoutes      = require('./modules/journal/journal.routes');
const journalsRoutes     = require('./modules/journals/journals.routes');

const app = express();

// ── Request logging ───────────────────────────────────────────────────────────
// dev: coloured single-line per request; production: Apache combined format
app.use(morgan(env.isDev ? 'dev' : 'combined'));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: env.cors.origins.length === 1 ? env.cors.origins[0] : env.cors.origins,
  credentials: true,
}));

// ── Cookie + Body parsing ─────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Global rate limiting (stricter limits applied per-route as needed) ────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
}));

// ── Health check ──────────────────────────────────────────────────────────────
// Two paths: /health (direct) and /api/v1/health (through nginx proxy).
// Both are public — no auth required. Used by the client for connectivity pings.
app.get('/health',        (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── API Routes ────────────────────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/companies`, companiesRoutes);
app.use(`${API}/branches`, branchesRoutes);
app.use(`${API}/users`, usersRoutes);
app.use(`${API}/products`, productsRoutes);
app.use(`${API}/inventory`, inventoryRoutes);
app.use(`${API}/customers`, customersRoutes);
app.use(`${API}/sales`, salesRoutes);
app.use(`${API}/returns`, returnsRoutes);
app.use(`${API}/pos`, posRoutes);
app.use(`${API}/reports`, reportsRoutes);
app.use(`${API}/platform`, platformRoutes);
app.use(`${API}/tax-rates`,    taxRoutes);
app.use(`${API}/mpesa`,        mpesaRoutes);
app.use(`${API}/ipn`,          mpesaRoutes); // alias without "mpesa" in path — Daraja sandbox rejects callback URLs containing that word
app.use(`${API}/accounts`,     accountsRoutes);
app.use(`${API}/bank-accounts`,bankAccountsRoutes);
app.use(`${API}/suppliers`,    suppliersRoutes);
app.use(`${API}/purchases`,        purchasesRoutes);
app.use(`${API}/grns`,             grnsRoutes);
app.use(`${API}/supplier-payments`, paymentsRoutes);
app.use(`${API}/journal`,          journalRoutes);
app.use(`${API}/journals`,         journalsRoutes);

// ── 404 + global error handler ────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
