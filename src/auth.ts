import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { sessions, users, type User } from "./db.js";
import { randomSecret, sha256Hex } from "./security.js";

const COOKIE = "xnx_session";
const TTL_DAYS = 30;

export interface PrivyIdentity {
  userId: string;
  email: string | null;
  wallet: string | null;
}

type Verifier = (token: string) => Promise<PrivyIdentity>;

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** Verify a Privy access token (ES256 JWT) against the app's published JWKS, then look up the user's email/wallet. */
async function verifyWithPrivy(token: string): Promise<PrivyIdentity> {
  const appId = config.PRIVY_APP_ID;
  if (!appId) throw new Error("Privy is not configured");
  jwks ??= createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: "privy.io", audience: appId });
  const userId = String(payload.sub ?? "");
  if (!userId) throw new Error("token has no subject");
  return { userId, ...(await fetchPrivyProfile(userId)) };
}

/** Email + wallet from Privy's REST API. Needs PRIVY_APP_SECRET; without it we still log the user in. */
async function fetchPrivyProfile(userId: string): Promise<{ email: string | null; wallet: string | null }> {
  if (!config.PRIVY_APP_SECRET || !config.PRIVY_APP_ID) return { email: null, wallet: null };
  try {
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
      signal: AbortSignal.timeout(6_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${config.PRIVY_APP_ID}:${config.PRIVY_APP_SECRET}`).toString("base64")}`,
        "privy-app-id": config.PRIVY_APP_ID,
      },
    });
    if (!res.ok) return { email: null, wallet: null };
    const user = (await res.json()) as { linked_accounts?: Array<Record<string, unknown>> };
    const accounts = user.linked_accounts ?? [];
    const email =
      (accounts.find((a) => a.type === "email")?.address as string | undefined) ??
      (accounts.find((a) => a.type === "google_oauth")?.email as string | undefined) ??
      null;
    const wallet = (accounts.find((a) => a.type === "wallet" && a.chain_type !== "solana")?.address as string | undefined) ?? null;
    return { email: email?.toLowerCase() ?? null, wallet };
  } catch {
    return { email: null, wallet: null };
  }
}

let verifier: Verifier = verifyWithPrivy;

/** Swap the token verifier (tests). */
export function useVerifier(v: Verifier): void {
  verifier = v;
}

export async function signIn(c: Context, token: string): Promise<User> {
  const id = await verifier(token);
  const user = users.upsert({ id: id.userId, email: id.email, wallet: id.wallet });
  const raw = randomSecret(32);
  sessions.create(sha256Hex(raw), user.id, TTL_DAYS);
  setCookie(c, COOKIE, raw, {
    httpOnly: true,
    secure: config.BASE_URL.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_DAYS * 24 * 3600,
  });
  return user;
}

export function signOut(c: Context): void {
  const raw = getCookie(c, COOKIE);
  if (raw) sessions.delete(sha256Hex(raw));
  deleteCookie(c, COOKIE, { path: "/" });
}

export function currentUser(c: Context): User | undefined {
  const raw = getCookie(c, COOKIE);
  if (!raw || raw.length > 100) return undefined;
  return sessions.user(sha256Hex(raw));
}
