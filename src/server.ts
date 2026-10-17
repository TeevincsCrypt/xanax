import { serve } from "@hono/node-server";
import { APP_NAME, config } from "./config.js";
import { db } from "./db.js";
import { createApp } from "./app.js";
import { ensureInitialized } from "./x402.js";

db(); // open + migrate before accepting traffic
console.log(`[db] ${config.DATABASE_URL}`);
if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.warn("[db] WARNING: no Railway volume attached. Products and orders will be LOST on every redeploy. Attach a volume to this service.");
}
const app = createApp();

serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`${APP_NAME} listening on :${info.port} · ${config.BASE_URL} · network=${config.network.label} (${config.network.caip2})`);
  ensureInitialized()
    .then(() => console.log("[x402] facilitator synced"))
    .catch((err) => console.error("[x402] facilitator sync failed (will retry on first paid request):", err?.message ?? err));
});
