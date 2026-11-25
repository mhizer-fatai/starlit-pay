import { supabase } from "../../config.js";
import { provenEmail, requireAuth } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { createCaptchaVerifier } from "../faucet/service.js";
import { createResendMailer } from "./mailer.js";
import { createBetaRepository } from "./repository.js";
import { createBetaService } from "./service.js";
import { createBetaRouter } from "./routes.js";

// BETA_INVITE_ONLY=on    new accounts need an approved email or an invite code
// ADMIN_EMAILS           comma-separated emails that may review applications and make codes
// BETA_TELEGRAM_URL      the Founding Testers group, sent only to approved applicants
// RESEND_API_KEY         sends the "you're in" email on approval (optional)
// MAIL_FROM              the sender, e.g. "Starlit Pay <hello@starlitpay.xyz>"
// APP_URL                links in emails (default https://starlitpay.xyz)
const inviteOnly = /^(on|true|1)$/i.test(process.env.BETA_INVITE_ONLY ?? "");
const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",");

const mailer = createResendMailer({
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.MAIL_FROM || "Starlit Pay <hello@starlitpay.xyz>",
  logger,
});

logger.info(`Beta sign-up is ${inviteOnly ? "invite-only" : "open"}; approval emails ${mailer.enabled ? "on" : "off (RESEND_API_KEY not set)"}.`);

export const betaService = createBetaService({
  repository: createBetaRepository(supabase),
  inviteOnly,
  adminEmails,
  telegramUrl: process.env.BETA_TELEGRAM_URL || null,
  appUrl: (process.env.APP_URL || "https://starlitpay.xyz").replace(/\/$/, ""),
  mailer,
  verifyCaptcha: createCaptchaVerifier({ secret: process.env.TURNSTILE_SECRET_KEY, production: process.env.NODE_ENV === "production" }),
});

export const betaRouter = createBetaRouter({ service: betaService, requireAuth, provenEmail });
