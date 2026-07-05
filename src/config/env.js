const required = ['MONGODB_URI', 'ADMIN_NUMBER'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_NUMBER: process.env.ADMIN_NUMBER,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT, 10) || 60000,
};
