import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { rateLimiter } from "./security.js";

/** Client IP: first X-Forwarded-For hop (Railway/Render/Fly put the client there), else the socket. */
export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// A PayBox purchase is 2 requests (probe + paid), so 60/min leaves plenty of headroom.
export const limitBuy = rateLimiter(60, 60_000);
export const limitSell = rateLimiter(10, 10 * 60_000);
export const limitApi = rateLimiter(120, 60_000);
export const limitDashboard = rateLimiter(60, 60_000);
