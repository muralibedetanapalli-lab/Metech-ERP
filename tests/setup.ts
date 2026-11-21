import "dotenv/config";

// Tests run against a dedicated database and never call a real Dukaan server.
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set to run tests");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DUKAAN_BASE_URL = "";
process.env.DUKAAN_API_KEY = "";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret-123456";
