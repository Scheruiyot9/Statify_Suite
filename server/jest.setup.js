// Set required env vars before any module loads — prevents env.js from throwing
process.env.DB_NAME     = 'test_db';
process.env.DB_USER     = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.JWT_SECRET          = 'test-jwt-secret-32-chars-minimum!!';
process.env.JWT_REFRESH_SECRET  = 'test-refresh-secret-32-chars-min!';
process.env.NODE_ENV = 'test';
