require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

module.exports = {
  nodeEnv:   process.env.NODE_ENV || 'development',
  port:      parseInt(process.env.PORT || '5000', 10),
  isDev:     (process.env.NODE_ENV || 'development') === 'development',

  db: {
    host:            process.env.DB_HOST || 'localhost',
    port:            parseInt(process.env.DB_PORT || '5432', 10),
    name:            required('DB_NAME'),
    user:            required('DB_USER'),
    password:        required('DB_PASSWORD'),
    poolMax:         parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeout:     parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000', 10),
    connectTimeout:  parseInt(process.env.DB_POOL_CONNECT_TIMEOUT || '2000', 10),
  },

  jwt: {
    secret:             required('JWT_SECRET'),
    expiresIn:          process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret:      required('JWT_REFRESH_SECRET'),
    refreshExpiresIn:   process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  cors: {
    // Supports comma-separated origins: "http://localhost:5173,https://demo.statify.co.ke"
    origins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',').map((o) => o.trim()).filter(Boolean),
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),

  email: {
    host:     process.env.SMTP_HOST     || '',
    port:     parseInt(process.env.SMTP_PORT || '587', 10),
    secure:   process.env.SMTP_SECURE === 'true',
    user:     process.env.SMTP_USER     || '',
    pass:     process.env.SMTP_PASS     || '',
    from:     process.env.EMAIL_FROM    || 'Statify POS <support@statify.co.ke>',
  },

  appUrl: process.env.APP_URL || 'http://localhost:5173',
};
