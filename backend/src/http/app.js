import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { requestContext } from "./requestContext.js";
import { accessLog } from "./logger.js";

// The Express app and the middleware every request passes through, in order.
// Routes are mounted by server.js.

export const app = express();

// First, so every later step (and its logs) carries the request id.
app.use(requestContext);
app.use(accessLog);

// Behind Render (and the Netlify /api proxy) the client IP arrives in
// X-Forwarded-For. Set TRUST_PROXY to the number of proxy hops (e.g. 1 on
// Render, 2 via Netlify) so rate limits apply per client instead of per proxy.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

// CORS Security Options: Allow Netlify, Localhost, Render, and Custom Domains
const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || "https://starlit-pay.netlify.app,http://localhost:5173,http://localhost:5175,http://localhost:3000").split(","),
  ...(process.env.CUSTOM_DOMAIN ? process.env.CUSTOM_DOMAIN.split(",") : []),
]
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Exact allow-list only: credentialed requests from any other site must be
      // refused, or cookie sessions could be used by a malicious page.
      const isLocalDev = process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const isNetlifyPreview = /^https:\/\/([a-z0-9-]+--)?starlit-pay\.netlify\.app$/.test(origin);

      callback(null, allowedOrigins.includes(origin) || isNetlifyPreview || isLocalDev);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-Client-*: sent by smart-account-kit's relayer client
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Supabase-Auth", "X-Client-Name", "X-Client-Version"],
    exposedHeaders: ["X-Request-Id"],
  })
);

// Standard Production Security Headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

const limit = (max, error) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { error } });

app.use("/api/", limit(200, "Too many requests from this IP, please try again later."));
app.use("/api/users/", limit(30, "Too many authentication attempts, please try again later."));
app.use("/api/faucet/", limit(10, "Too many faucet requests from this IP, please try again later."));
app.use("/api/beta/", limit(30, "Too many beta requests from this IP, please try again later."));
app.use("/api/relayer/", limit(30, "Too many transaction submissions from this IP, please try again later."));
// Passkey ceremonies, session refresh and vault unlocks (per-account PIN limits apply on top)
const sessionAuthLimiter = limit(60, "Too many sign-in requests from this IP, please try again later.");
app.use("/api/auth/", sessionAuthLimiter);
app.use("/api/vault/", sessionAuthLimiter);

// Larger bodies only where a route accepts them (avatar uploads); everything else stays small.
app.patch(/^\/api\/users\/(me|profile)$/, express.json({ limit: "2mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
