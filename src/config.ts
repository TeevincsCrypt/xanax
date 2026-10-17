import { z } from "zod";

/** The product name. Used everywhere; change it here and only here. */
export const APP_NAME = process.env.APP_NAME?.trim() || "Xanax";

const NETWORKS = {
  "base-sepolia": {
    caip2: "eip155:84532",
    label: "base-sepolia",
    explorer: "https://sepolia.basescan.org",
    // Circle's USDC on Base Sepolia; also the @x402/evm default for eip155:84532.
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    testnet: true,
  },
  base: {
    caip2: "eip155:8453",
    label: "base",
    explorer: "https://basescan.org",
    // Circle's native USDC on Base mainnet; also the @x402/evm default for eip155:8453.
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    testnet: false,
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  X402_NETWORK: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
  FACILITATOR_URL: z.string().url().optional(),
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
  DATABASE_URL: z.string().default("file:./data/xanax.db"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  SIGNING_SECRET: z.string().optional(),
  MAX_PRICE_USD: z.coerce.number().positive().default(500),
  MAX_QTY: z.coerce.number().int().positive().default(10),
});

function blankToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  // Trim: a stray space or newline pasted into a dashboard silently breaks token comparisons.
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v?.trim() === "" ? undefined : v?.trim()]));
}

const env = EnvSchema.parse(blankToUndefined(process.env));

/**
 * On Railway, keep SQLite on the attached volume wherever it's mounted. The Dockerfile default
 * (/data) only persists if the volume is mounted exactly there.
 */
function resolveDatabaseUrl(): string {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (mount && env.DATABASE_URL === "file:/data/xanax.db") return `file:${mount.replace(/\/+$/, "")}/xanax.db`;
  return env.DATABASE_URL;
}

export const config = {
  ...env,
  DATABASE_URL: resolveDatabaseUrl(),
  BASE_URL: env.BASE_URL.replace(/\/+$/, ""),
  network: NETWORKS[env.X402_NETWORK],
  /**
   * Secret for signing download links. Falls back to ADMIN_TOKEN so a fresh deploy works,
   * and finally to a per-process random value (links then die on restart, which is safe).
   */
  signingSecret:
    env.SIGNING_SECRET ||
    env.ADMIN_TOKEN ||
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  emailEnabled: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
};

export function explorerTxUrl(txHash: string): string {
  return `${config.network.explorer}/tx/${txHash}`;
}
