import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { agent } from "./routes/agent.js";
import { buy } from "./routes/buy.js";
import { merchant } from "./routes/merchant.js";
import { messagePage } from "./views/pages.js";

export function createApp() {
  const app = new Hono();
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "https:", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: false,
    }),
  );
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Request body too large" }, 413) }));
  // x402 response headers must be readable by browser-based agents.
  app.use("/buy/*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
  });
  app.options("/buy/*", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT");
    return c.body(null, 204);
  });
  app.route("/", buy);
  app.route("/", agent);
  app.route("/", merchant);
  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.html(messagePage("Not found", "There's nothing here."), 404),
  );
  app.onError((err, c) => {
    console.error("[error]", c.req.method, c.req.path, err);
    return c.req.path.startsWith("/api/") || c.req.path.startsWith("/buy/")
      ? c.json({ error: "Internal error" }, 500)
      : c.html(messagePage("Error", "Something went wrong."), 500);
  });
  return app;
}
