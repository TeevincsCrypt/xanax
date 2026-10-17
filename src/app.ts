import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { agent } from "./routes/agent.js";
import { buy } from "./routes/buy.js";
import { merchant } from "./routes/merchant.js";
import { messagePage } from "./views/pages.js";
import { LOGO_SVG } from "./views/layout.js";
import { serveStatic } from "@hono/node-server/serve-static";

export function createApp() {
  const app = new Hono();
  const csp = {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", "https:", "data:"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    frameAncestors: ["'none'"],
  };
  const strict = secureHeaders({ contentSecurityPolicy: csp, crossOriginResourcePolicy: false });
  // Privy's login modal talks to auth.privy.io, wallet relays (wss) and embeds its own iframes.
  const privy = secureHeaders({
    contentSecurityPolicy: {
      ...csp,
      imgSrc: ["'self'", "https:", "data:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:"],
      frameSrc: ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org", "https://*.privy.io"],
      childSrc: ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org"],
      workerSrc: ["'self'", "blob:"],
    },
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: "same-origin-allow-popups",
  });
  app.use("*", (c, next) => (c.req.path === "/login" || c.req.path === "/logout" ? privy(c, next) : strict(c, next)));
  // Listings can carry an image (5 MB) and a digital file (25 MB); everything else stays small.
  app.use("*", (c, next) =>
    bodyLimit({
      maxSize: c.req.path === "/sell" ? 32 * 1024 * 1024 : 64 * 1024,
      onError: (cc) => (cc.req.path === "/sell" ? cc.html(messagePage("Too large", "Your upload is over the size limit (image 5 MB, file 25 MB)."), 413) : cc.json({ error: "Request body too large" }, 413)),
    })(c, next),
  );
  app.use("/js/*", serveStatic({ root: "./public" }));
  app.get("/logo.svg", (c) => {
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(LOGO_SVG);
  });
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
