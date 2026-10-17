import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: ":memory:",
      BASE_URL: "https://xanax.test",
      X402_NETWORK: "base-sepolia",
      SIGNING_SECRET: "test-signing-secret",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
    },
    pool: "forks",
  },
});
