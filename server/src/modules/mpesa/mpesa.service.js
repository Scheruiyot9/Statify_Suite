const { query } = require('../../config/database');
const AppError  = require('../../shared/AppError');
const QueryBuilder = require('../../shared/qb');
const { isCompanyWide } = require('../../shared/roles');

// Per-process access-token cache keyed by config_id.
// Tokens are valid for 1 hour; we refresh 60 s early.
// NOTE: this is in-process only. With multiple workers (PM2 cluster, multiple dynos)
// each worker fetches its own token independently — harmless but redundant.
// Replace with a shared Redis cache if running more than one Node process.
const tokenCache = new Map();

// Pending STK sessions keyed by CheckoutRequestID.
// Backed by the stk_sessions DB table so sessions survive server restarts.
// NOTE: same single-process caveat as tokenCache above — a push on worker 1 is
// immediately visible to worker 2 only via the DB fallback path, not this Map.
const stkSessions = new Map();

// ── Daraja helpers ────────────────────────────────────────────────────────────

const DARAJA_BASE = {
  sandbox:    'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

function darajaBase(environment) {
  return DARAJA_BASE[environment] || DARAJA_BASE.sandbox;
}

function mpesaTimestamp() {
  return new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

// Normalise Kenyan phone numbers to 2547XXXXXXXX format
function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0')   && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9)                              return `254${digits}`;
  return digits; // pass through if already unusual
}

// Fetch the best config for a given branch:
//   1. Branch-specific config (if branchId provided and configured)
//   2. Company-wide fallback (branch_id IS NULL)
async function fetchConfig(companyId, branchId) {
  const { rows } = await query(
    `SELECT * FROM mpesa_config
     WHERE company_id = $1 AND is_active = TRUE
       AND (branch_id = $2 OR branch_id IS NULL)
     ORDER BY branch_id NULLS LAST
     LIMIT 1`,
    [companyId, branchId || null]
  );
  if (!rows.length)
    throw AppError.badRequest(
      'M-Pesa is not configured for this branch. Add credentials under Settings → M-Pesa.',
      'MPESA_NOT_CONFIGURED'
    );
  return rows[0];
}

async function fetchToken(config, { forceRefresh = false } = {}) {
  const cacheKey = config.config_id;
  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const creds = Buffer.from(
    `${config.consumer_key.trim()}:${config.consumer_secret.trim()}`
  ).toString('base64');

  const res = await fetch(
    `${darajaBase(config.environment)}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` } }
  );

  const raw  = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }

  if (!res.ok) {
    console.error('[mpesa-token] OAuth failed:', res.status, raw.slice(0, 200));
    throw AppError.badRequest(
      `M-Pesa OAuth failed (${res.status}): ${data.errorMessage || raw.slice(0, 80)}`,
      'MPESA_AUTH_FAILED'
    );
  }

  const token = (data.access_token || '').trim();
  if (!token) {
    console.error('[mpesa-token] Empty token in response:', raw.slice(0, 200));
    throw AppError.internal('M-Pesa returned an empty access token');
  }

  const ttl = parseInt(data.expires_in, 10) || 3600;
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + (ttl - 120) * 1000, // refresh 2 min before expiry
  });
  return token;
}

function invalidateToken(configId) {
  tokenCache.delete(configId);
}

// Returns true when a Daraja JSON body signals an invalid/expired token
function isTokenError(data) {
  const msg = (data.errorMessage || data.ResultDesc || '').toLowerCase();
  return (
    data.errorCode === '404.001.03' ||
    msg.includes('invalid access token') ||
    msg.includes('access token expired') ||
    msg.includes('invalid credentials') ||
    msg.includes('bad request: invalid credentials')
  );
}

// Thin wrapper: POST to Daraja with automatic token-refresh retry on auth errors
async function darajaPost(url, body, config) {
  const attempt = async (forceRefresh) => {
    const token = await fetchToken(config, { forceRefresh });
    const res   = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:   JSON.stringify(body),
    });
    const raw  = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }
    return { res, data, raw };
  };

  let { res, data, raw } = await attempt(false);

  // If Daraja rejects the token, evict cache and retry once with a fresh one
  if (isTokenError(data)) {
    console.warn('[mpesa] Token rejected by Daraja — refreshing and retrying');
    invalidateToken(config.config_id);
    ({ res, data, raw } = await attempt(true));
  }

  if (!res.ok && Object.keys(data).length === 0) {
    console.error('[mpesa] Daraja non-JSON response:', res.status, raw.slice(0, 200));
  }

  return { res, data };
}

// ── Config management ─────────────────────────────────────────────────────────

// Returns all branch configs for a company (array, one entry per branch or company-wide)
async function getConfigForCompany(companyId) {
  const { rows } = await query(
    `SELECT mc.config_id, mc.company_id, mc.branch_id, mc.shortcode, mc.shortcode_type,
            mc.environment, mc.callback_url, mc.is_active, mc.created_at, mc.updated_at,
            b.branch_name,
            left(mc.consumer_key,    6) || '***' AS consumer_key,
            left(mc.consumer_secret, 6) || '***' AS consumer_secret,
            left(mc.passkey,         6) || '***' AS passkey
     FROM mpesa_config mc
     LEFT JOIN branches b ON b.branch_id = mc.branch_id
     WHERE mc.company_id = $1
     ORDER BY b.branch_name NULLS FIRST`,
    [companyId]
  );
  return rows;
}

async function saveConfig(companyId, branchId, {
  consumerKey, consumerSecret, shortcode, shortcodeType,
  passkey, environment, callbackUrl,
}) {
  if (!consumerKey || !consumerSecret || !shortcode || !passkey)
    throw AppError.badRequest('consumerKey, consumerSecret, shortcode and passkey are required');

  const bid = branchId || null;

  // Two separate upserts because ON CONFLICT with partial indexes requires matching the predicate
  let rows;
  if (bid) {
    ({ rows } = await query(`
      INSERT INTO mpesa_config
        (company_id, branch_id, consumer_key, consumer_secret, shortcode, shortcode_type,
         passkey, environment, callback_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (company_id, branch_id) WHERE branch_id IS NOT NULL DO UPDATE
        SET consumer_key    = EXCLUDED.consumer_key,
            consumer_secret = EXCLUDED.consumer_secret,
            shortcode       = EXCLUDED.shortcode,
            shortcode_type  = EXCLUDED.shortcode_type,
            passkey         = EXCLUDED.passkey,
            environment     = EXCLUDED.environment,
            callback_url    = EXCLUDED.callback_url,
            is_active       = TRUE,
            updated_at      = now()
      RETURNING config_id, branch_id, shortcode, shortcode_type, environment, is_active
    `, [
      companyId, bid, consumerKey, consumerSecret, shortcode,
      shortcodeType || 'paybill', passkey,
      environment || 'sandbox', callbackUrl || null,
    ]));
  } else {
    ({ rows } = await query(`
      INSERT INTO mpesa_config
        (company_id, consumer_key, consumer_secret, shortcode, shortcode_type,
         passkey, environment, callback_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (company_id) WHERE branch_id IS NULL DO UPDATE
        SET consumer_key    = EXCLUDED.consumer_key,
            consumer_secret = EXCLUDED.consumer_secret,
            shortcode       = EXCLUDED.shortcode,
            shortcode_type  = EXCLUDED.shortcode_type,
            passkey         = EXCLUDED.passkey,
            environment     = EXCLUDED.environment,
            callback_url    = EXCLUDED.callback_url,
            is_active       = TRUE,
            updated_at      = now()
      RETURNING config_id, branch_id, shortcode, shortcode_type, environment, is_active
    `, [
      companyId, consumerKey, consumerSecret, shortcode,
      shortcodeType || 'paybill', passkey,
      environment || 'sandbox', callbackUrl || null,
    ]));
  }

  invalidateToken(rows[0].config_id);
  return rows[0];
}

// ── STK Push ──────────────────────────────────────────────────────────────────

async function initiateSTKPush(companyId, branchId, {
  phone, amount, accountReference, description,
}) {
  if (!phone)                       throw AppError.badRequest('Phone number is required');
  if (!amount || parseFloat(amount) <= 0) throw AppError.badRequest('Amount must be greater than 0');

  const config = await fetchConfig(companyId, branchId);
  const base   = darajaBase(config.environment);
  const ts     = mpesaTimestamp();
  const password = Buffer.from(
    `${config.shortcode.trim()}${config.passkey.trim()}${ts}`
  ).toString('base64');

  const formattedPhone = formatPhone(phone);
  let apiBase = null;
  try { if (config.callback_url) apiBase = new URL(config.callback_url).origin; } catch {}
  apiBase = apiBase || (process.env.API_BASE_URL || '').trim() || null;
  if (!apiBase)
    throw AppError.badRequest(
      'Set API_BASE_URL in your environment (or a Callback URL in the M-Pesa config) before initiating STK Push.',
      'MISSING_API_BASE_URL'
    );
  const callbackUrl = `${apiBase}/api/v1/mpesa/callback`;

  const stkBody = {
    BusinessShortCode: config.shortcode.trim(),
    Password:          password,
    Timestamp:         ts,
    TransactionType:   config.shortcode_type === 'till'
      ? 'CustomerBuyGoodsOnline'
      : 'CustomerPayBillOnline',
    Amount:           Math.ceil(parseFloat(amount)),
    PartyA:           formattedPhone,
    PartyB:           config.shortcode.trim(),
    PhoneNumber:      formattedPhone,
    CallBackURL:      callbackUrl,
    AccountReference: String(accountReference || 'POS').slice(0, 12),
    TransactionDesc:  String(description || 'POS Payment').slice(0, 13),
  };

  const { res, data } = await darajaPost(
    `${base}/mpesa/stkpush/v1/processrequest`,
    stkBody,
    config
  );

  if (!res.ok || data.errorCode || (data.ResponseCode && data.ResponseCode !== '0')) {
    const msg = data.errorMessage || data.ResponseDescription || 'STK Push request failed';
    console.error('[mpesa-stk] Failed:', res.status, JSON.stringify(data).slice(0, 200));
    throw AppError.badRequest(msg, 'MPESA_STK_FAILED');
  }

  const sessionData = {
    companyId,
    branchId:         branchId || null,
    phone:            formattedPhone,
    amount:           parseFloat(amount),
    accountReference: accountReference || 'POS',
    description:      description || 'POS Payment',
    initiatedAt:      Date.now(),
  };

  // Keep in memory for fast polling access
  stkSessions.set(data.CheckoutRequestID, sessionData);

  // Also persist to DB so callbacks survive server restarts.
  // Fire-and-forget — a failure here doesn't block the STK push response.
  query(
    `INSERT INTO stk_sessions
       (checkout_request_id, company_id, branch_id, phone, amount, account_reference, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (checkout_request_id) DO NOTHING`,
    [
      data.CheckoutRequestID, companyId, branchId || null,
      formattedPhone, parseFloat(amount),
      accountReference || 'POS', description || 'POS Payment',
    ]
  ).catch((e) => console.error('[mpesa-stk] session persist failed:', e.message));

  // Purge stale sessions older than 1 hour (housekeeping)
  query(`DELETE FROM stk_sessions WHERE created_at < now() - interval '1 hour'`).catch(() => {});

  return {
    mpesaTxnId:        null,
    checkoutRequestId: data.CheckoutRequestID,
    status:            'pending',
  };
}

// Check STK push status.
// Primary path: callback-created DB record (works when callback URL is publicly reachable).
// Fallback: query Daraja directly after 8 s (handles localhost dev where callbacks can't arrive).
async function querySTKStatus(companyId, checkoutRequestId) {
  const { rows } = await query(
    `SELECT mpesa_txn_id, status, mpesa_receipt_number, amount::numeric, failure_reason
     FROM mpesa_transactions
     WHERE checkout_request_id = $1 AND company_id = $2`,
    [checkoutRequestId, companyId]
  );

  if (rows.length) {
    const rec = rows[0];
    return {
      mpesaTxnId:         rec.mpesa_txn_id,
      status:             rec.status,
      mpesaReceiptNumber: rec.mpesa_receipt_number,
      amount:             parseFloat(rec.amount),
      failureReason:      rec.failure_reason,
    };
  }

  let session = stkSessions.get(checkoutRequestId);

  // If not in memory (server restart), try the DB-persisted session
  if (!session) {
    const { rows: dbRows } = await query(
      `SELECT * FROM stk_sessions WHERE checkout_request_id = $1`,
      [checkoutRequestId]
    );
    if (dbRows.length) {
      const r = dbRows[0];
      session = {
        companyId:        r.company_id,
        branchId:         r.branch_id,
        phone:            r.phone,
        amount:           parseFloat(r.amount),
        accountReference: r.account_reference,
        description:      r.description,
        initiatedAt:      new Date(r.created_at).getTime(),
      };
      // Restore to in-memory map so subsequent polls are fast
      stkSessions.set(checkoutRequestId, session);
    }
  }

  const amount = session?.amount ?? 0;

  if (!session) return { mpesaTxnId: null, status: 'pending', amount };

  // Wait 55 s before falling back to a direct Daraja query.
  // Daraja's STK prompt is active for ~60 s; querying before it expires always
  // returns 1037 ("DS Timeout") even while the customer is still responding.
  // The callback path (primary) resolves this much sooner when the URL is reachable.
  const elapsedSecs = (Date.now() - session.initiatedAt) / 1000;
  if (elapsedSecs < 55) return { mpesaTxnId: null, status: 'pending', amount };

  try {
    const config   = await fetchConfig(companyId, session.branchId);
    const base     = darajaBase(config.environment);
    const ts       = mpesaTimestamp();
    const password = Buffer.from(
      `${config.shortcode.trim()}${config.passkey.trim()}${ts}`
    ).toString('base64');

    const { data } = await darajaPost(
      `${base}/mpesa/stkpushquery/v1/query`,
      { BusinessShortCode: config.shortcode.trim(), Password: password, Timestamp: ts, CheckoutRequestID: checkoutRequestId },
      config
    );

    const code = String(data.ResultCode ?? '');

    if (code === '0') {
      // Payment confirmed but callback was missed (or URL not reachable) — create record
      const { rows: ins } = await query(`
        INSERT INTO mpesa_transactions
          (company_id, branch_id, checkout_request_id, payment_mode, phone_number, amount,
           account_reference, description, status, result_code, completed_at)
        VALUES ($1,$2,$3,'stk_push',$4,$5,$6,$7,'completed',$8,now())
        ON CONFLICT (checkout_request_id) WHERE checkout_request_id IS NOT NULL DO NOTHING
        RETURNING mpesa_txn_id
      `, [
        companyId, session.branchId, checkoutRequestId,
        session.phone, session.amount,
        session.accountReference, session.description, code,
      ]);
      stkSessions.delete(checkoutRequestId);

      // ON CONFLICT DO NOTHING → callback arrived concurrently; re-read the full row
      if (!ins.length) {
        const { rows: existing } = await query(
          `SELECT mpesa_txn_id, mpesa_receipt_number FROM mpesa_transactions WHERE checkout_request_id = $1`,
          [checkoutRequestId]
        );
        const row = existing[0];
        return { mpesaTxnId: row?.mpesa_txn_id ?? null, status: 'completed', mpesaReceiptNumber: row?.mpesa_receipt_number ?? null, amount };
      }
      return { mpesaTxnId: ins[0].mpesa_txn_id, status: 'completed', mpesaReceiptNumber: null, amount };

    } else if (code !== '' && code !== 'undefined') {
      // Terminal failure — tell the client; don't clutter the DB with failed attempts
      const newStatus = code === '1032' ? 'cancelled' : code === '1037' ? 'timeout' : 'failed';
      stkSessions.delete(checkoutRequestId);
      return { mpesaTxnId: null, status: newStatus, amount, failureReason: data.ResultDesc || null };
    }
    // Empty code → Daraja still processing; keep polling
  } catch (err) {
    console.error('[mpesa-stk-query] Daraja fallback failed:', err.message);
  }

  return { mpesaTxnId: null, status: 'pending', amount };
}

// ── Daraja callback (called by M-Pesa server) ─────────────────────────────────
// This is the ONLY place that creates mpesa_transaction records for STK pushes.
// The POS never inserts — it only reads (via querySTKStatus) and links sales (linkToSale).

async function processCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return;

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = cb;
  const succeeded = ResultCode === 0 || ResultCode === '0';

  // Recover metadata from in-memory session first (fast path).
  // Fall back to DB-persisted stk_sessions when Map is cold (server restart scenario).
  let session = stkSessions.get(CheckoutRequestID);
  stkSessions.delete(CheckoutRequestID);

  if (!session) {
    const { rows: dbRows } = await query(
      `DELETE FROM stk_sessions WHERE checkout_request_id = $1 RETURNING *`,
      [CheckoutRequestID]
    );
    if (dbRows.length) {
      const r = dbRows[0];
      session = {
        companyId:        r.company_id,
        branchId:         r.branch_id,
        phone:            r.phone,
        amount:           parseFloat(r.amount),
        accountReference: r.account_reference,
        description:      r.description,
        initiatedAt:      new Date(r.created_at).getTime(),
      };
      console.log('[mpesa-callback] Recovered session from DB for', CheckoutRequestID);
    }
  } else {
    // Also clean up the DB row so we don't accumulate stale entries
    query(
      `DELETE FROM stk_sessions WHERE checkout_request_id = $1`,
      [CheckoutRequestID]
    ).catch(() => {});
  }

  if (!session) {
    console.warn('[mpesa-callback] No session for', CheckoutRequestID, '— cannot record payment');
    return;
  }

  let receiptNumber = null;
  let amount        = session.amount;
  let phone         = session.phone;

  if (Array.isArray(CallbackMetadata?.Item)) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') receiptNumber = String(item.Value);
      if (item.Name === 'Amount')             amount        = parseFloat(item.Value) || amount;
      if (item.Name === 'PhoneNumber')        phone         = String(item.Value)     || phone;
    }
  }

  if (!succeeded) {
    const code = String(ResultCode);
    const reason = code === '1032' ? 'cancelled' : code === '1037' ? 'prompt expired' : 'failed';
    console.log('[mpesa-callback] payment %s for %s — not recorded', reason, CheckoutRequestID);
    return;
  }

  // Only completed payments are written to mpesa_transactions.
  // ON CONFLICT DO UPDATE backfills the receipt number if the Daraja query fallback
  // already created the row (which has no receipt number since the query API doesn't return one).
  await query(`
    INSERT INTO mpesa_transactions
      (company_id, branch_id, checkout_request_id, payment_mode, phone_number, amount,
       account_reference, description, status, mpesa_receipt_number,
       result_code, callback_payload, completed_at)
    VALUES ($1,$2,$3,'stk_push',$4,$5,$6,$7,'completed',$8,$9,$10,now())
    ON CONFLICT (checkout_request_id) WHERE checkout_request_id IS NOT NULL DO UPDATE SET
      mpesa_receipt_number = COALESCE(EXCLUDED.mpesa_receipt_number, mpesa_transactions.mpesa_receipt_number),
      status               = 'completed',
      result_code          = EXCLUDED.result_code,
      callback_payload     = EXCLUDED.callback_payload,
      completed_at         = COALESCE(mpesa_transactions.completed_at, EXCLUDED.completed_at),
      updated_at           = now()
  `, [
    session.companyId, session.branchId, CheckoutRequestID,
    phone, amount,
    session.accountReference, session.description,
    receiptNumber, String(ResultCode),
    JSON.stringify(body),
  ]);
}

// ── C2B (direct paybill/till payments — customer-initiated) ──────────────────

// Called by Daraja's confirmation callback when a customer pays directly to the paybill.
// Identifies the company by matching BusinessShortCode → mpesa_config.shortcode.
async function processC2BCallback(body) {
  // Daraja uses TransID / BusinessShortCode / TransAmount / MSISDN.
  // Accept common aliases so sandbox simulations work without exact field names.
  const b = body || {};
  const TransID           = b.TransID           || b.transID           || b.transId;
  const BusinessShortCode = b.BusinessShortCode || b.ShortCode         || b.shortCode;
  const TransAmount       = b.TransAmount       || b.Amount            || b.amount;
  const BillRefNumber     = b.BillRefNumber     || b.billRefNumber     || b.AccountReference;
  const MSISDN            = b.MSISDN            || b.Msisdn            || b.msisdn            || b.PhoneNumber;
  const FirstName         = b.FirstName  || '';
  const LastName          = b.LastName   || '';

  if (!TransID || !BusinessShortCode) {
    console.warn('[mpesa-c2b] Missing TransID or BusinessShortCode — got:', JSON.stringify(b).slice(0, 200));
    return;
  }

  // Resolve company from shortcode
  const { rows: cfgRows } = await query(
    `SELECT company_id FROM mpesa_config WHERE shortcode = $1 AND is_active = TRUE LIMIT 1`,
    [String(BusinessShortCode)]
  );
  if (!cfgRows.length) {
    // Log all active shortcodes so the mismatch is visible in server logs
    const { rows: allCodes } = await query(
      `SELECT shortcode FROM mpesa_config WHERE is_active = TRUE`
    );
    console.warn(
      '[mpesa-c2b] No active config for shortcode "%s". Active shortcodes in DB: [%s]',
      BusinessShortCode,
      allCodes.map((r) => r.shortcode).join(', ') || 'none'
    );
    return;
  }

  const { company_id } = cfgRows[0];
  const name = [FirstName, LastName].filter(Boolean).join(' ');

  await query(`
    INSERT INTO mpesa_transactions
      (company_id, branch_id, payment_mode, phone_number, amount,
       mpesa_receipt_number, account_reference, description,
       status, completed_at, callback_payload)
    VALUES ($1, NULL, 'c2b', $2, $3, $4, $5, $6, 'completed', now(), $7)
    ON CONFLICT (mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL DO NOTHING
  `, [
    company_id,
    MSISDN ? formatPhone(String(MSISDN)) : null,
    parseFloat(TransAmount) || 0,
    String(TransID),
    BillRefNumber  || null,
    name ? `C2B: ${name}` : 'C2B Payment',
    JSON.stringify(body),
  ]);
}

// Register C2B confirmation + validation URLs with Daraja for a given config.
// Must be called once per shortcode (or whenever the callback URL changes).
async function registerC2BUrl(companyId, branchId) {
  const config = await fetchConfig(companyId, branchId);
  const base   = darajaBase(config.environment);

  // Derive public base URL from callback_url or API_BASE_URL env
  let apiBase = (process.env.API_BASE_URL || '').trim();
  if (!apiBase && config.callback_url) {
    try { apiBase = new URL(config.callback_url).origin; } catch {}
  }
  if (!apiBase)
    throw AppError.badRequest(
      'Set API_BASE_URL in your environment (or a Callback URL in the config) before registering C2B.',
      'MISSING_API_BASE_URL'
    );

  const confirmationURL = `${apiBase}/api/v1/ipn/callback/c2b`;
  const validationURL   = `${apiBase}/api/v1/ipn/callback/c2b/validate`;

  const { res, data } = await darajaPost(
    `${base}/mpesa/c2b/v1/registerurl`,
    {
      ShortCode:       config.shortcode.trim(),
      ResponseType:    'Completed',
      ConfirmationURL: confirmationURL,
      ValidationURL:   validationURL,
    },
    config
  );

  console.log('[mpesa-c2b-register] status=%d body=%s', res.status, JSON.stringify(data));

  // ResponseCode '0' = success; some Daraja responses omit it on 200 OK
  // "already registered" is also treated as success — URLs are already in place
  const responseCode  = String(data.ResponseCode ?? '');
  const description   = (data.ResponseDescription || '').toLowerCase();
  const alreadyDone   = description.includes('already') || description.includes('exists');
  const darajaError   = data.errorCode || data.errorMessage; // error envelope (no ResponseCode)
  const failed = !alreadyDone && (!res.ok || darajaError) && responseCode !== '0';
  if (failed) {
    const detail = data.errorMessage || data.ResponseDescription || data.errorCode
      || `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`;
    throw AppError.badRequest(`C2B registration failed — ${detail}`, 'C2B_REGISTRATION_FAILED');
  }

  return { confirmationURL, validationURL, daraja: data };
}

// ── Manual receipt entry ──────────────────────────────────────────────────────

async function recordManualPayment(companyId, branchId, {
  phone, amount, receiptNumber, accountReference, description,
}) {
  if (!receiptNumber || !receiptNumber.trim())
    throw AppError.badRequest('M-Pesa receipt number is required');
  if (!amount || parseFloat(amount) <= 0)
    throw AppError.badRequest('Amount must be greater than 0');

  const receipt = receiptNumber.toUpperCase().trim();

  const { rows } = await query(`
    INSERT INTO mpesa_transactions
      (company_id, branch_id, payment_mode, phone_number, amount,
       account_reference, description, status, mpesa_receipt_number, completed_at)
    VALUES ($1,$2,'manual',$3,$4,$5,$6,'completed',$7,now())
    ON CONFLICT (mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL DO NOTHING
    RETURNING mpesa_txn_id, status, mpesa_receipt_number, amount::numeric
  `, [
    companyId, branchId || null,
    phone ? formatPhone(phone) : null,
    parseFloat(amount),
    accountReference || 'POS',
    description || 'Manual M-Pesa entry',
    receipt,
  ]);

  if (!rows.length)
    throw AppError.conflict('This M-Pesa receipt number has already been recorded', 'DUPLICATE_RECEIPT');

  return {
    mpesaTxnId:         rows[0].mpesa_txn_id,
    status:             'completed',
    mpesaReceiptNumber: rows[0].mpesa_receipt_number,
    amount:             parseFloat(rows[0].amount),
  };
}

// ── Unlinked payments (received but not yet applied to any sale) ──────────────
// Used by the cashier's "Find Received Payment" lookup in manual mode.
// Returns completed M-Pesa transactions for this company that have no
// sales_transaction_id — i.e. money is sitting there waiting to be matched.

async function listUnlinked(companyId, { amount, hours = 48 } = {}) {
  const qb = new QueryBuilder([companyId]);
  const conditions = [
    `mt.company_id = $1`,
    `mt.status = 'completed'`,
    `mt.sales_transaction_id IS NULL`,
    `mt.completed_at >= now() - ($${qb.add(hours)} || ' hours')::interval`,
  ];

  // When an amount is supplied, match exactly (M-Pesa amounts are always whole KES)
  if (amount !== undefined && amount !== null && amount !== '') {
    conditions.push(`mt.amount = $${qb.add(Math.round(parseFloat(amount)))}`);
  }

  const { rows } = await query(`
    SELECT
      mt.mpesa_txn_id,
      mt.mpesa_receipt_number,
      mt.phone_number,
      mt.amount::numeric,
      mt.payment_mode,
      mt.account_reference,
      mt.completed_at
    FROM mpesa_transactions mt
    WHERE ${conditions.join(' AND ')}
    ORDER BY mt.completed_at DESC
    LIMIT 30
  `, qb.params);

  return rows.map((r) => ({
    mpesa_txn_id:         r.mpesa_txn_id,
    mpesa_receipt_number: r.mpesa_receipt_number,
    phone_number:         r.phone_number,
    amount:               parseFloat(r.amount),
    payment_mode:         r.payment_mode,
    account_reference:    r.account_reference,
    completed_at:         r.completed_at,
  }));
}

// ── Link M-Pesa txn to a completed sale ──────────────────────────────────────

async function linkToSale(companyId, mpesaTxnId, salesTransactionId) {
  if (!salesTransactionId) throw AppError.badRequest('salesTransactionId is required');
  if (!mpesaTxnId)         throw AppError.badRequest('mpesaTxnId is required');
  const { rowCount } = await query(
    `UPDATE mpesa_transactions
     SET sales_transaction_id = $2, updated_at = now()
     WHERE mpesa_txn_id = $1 AND company_id = $3`,
    [mpesaTxnId, salesTransactionId, companyId]
  );
  if (rowCount === 0)
    console.warn('[mpesa] linkToSale: no row matched mpesaTxnId', mpesaTxnId);
}

// ── Transaction listing ───────────────────────────────────────────────────────

async function listTransactions(companyId, role, branchIds, filters = {}) {
  const {
    branchId, status, paymentMode, startDate, endDate, search,
    page = 1, limit = 25,
  } = filters;

  const qb = new QueryBuilder([companyId]);
  const conditions = ['mt.company_id = $1'];

  if (!isCompanyWide(role)) {
    const ids = branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000'];
    conditions.push(`(mt.branch_id = ANY($${qb.add(ids)}) OR mt.branch_id IS NULL)`);
  } else if (branchId) {
    conditions.push(`mt.branch_id = $${qb.add(branchId)}`);
  }

  if (status)      conditions.push(`mt.status = $${qb.add(status)}`);
  if (paymentMode) conditions.push(`mt.payment_mode = $${qb.add(paymentMode)}`);
  if (startDate)   conditions.push(`mt.initiated_at::date >= $${qb.add(startDate)}`);
  if (endDate)     conditions.push(`mt.initiated_at::date <= $${qb.add(endDate)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(
      `(mt.mpesa_receipt_number ILIKE $${p} OR mt.phone_number ILIKE $${p}` +
      ` OR st.transaction_number ILIKE $${p})`
    );
  }

  const pg     = Math.max(1, parseInt(page, 10));
  const lm     = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      mt.mpesa_txn_id,
      mt.payment_mode,
      mt.phone_number,
      mt.amount::numeric,
      mt.mpesa_receipt_number,
      mt.account_reference,
      mt.status,
      mt.failure_reason,
      mt.initiated_at,
      mt.completed_at,
      b.branch_name,
      st.transaction_number AS sale_number,
      COUNT(*) OVER() AS total_count
    FROM mpesa_transactions mt
    LEFT JOIN branches b           ON b.branch_id             = mt.branch_id
    LEFT JOIN sales_transactions st ON st.transaction_id       = mt.sales_transaction_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY mt.initiated_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;

  return {
    transactions: rows.map((r) => ({
      mpesa_txn_id:         r.mpesa_txn_id,
      payment_mode:         r.payment_mode,
      phone_number:         r.phone_number,
      amount:               parseFloat(r.amount),
      mpesa_receipt_number: r.mpesa_receipt_number,
      account_reference:    r.account_reference,
      status:               r.status,
      failure_reason:       r.failure_reason,
      initiated_at:         r.initiated_at,
      completed_at:         r.completed_at,
      branch_name:          r.branch_name,
      sale_number:          r.sale_number,
    })),
    total, page: pg, limit: lm,
    pages: Math.max(1, Math.ceil(total / lm)),
  };
}

module.exports = {
  getConfigForCompany, saveConfig,
  initiateSTKPush, querySTKStatus, processCallback,
  processC2BCallback, registerC2BUrl,
  recordManualPayment, listUnlinked, linkToSale,
  listTransactions,
};
