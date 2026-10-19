import nodemailer from "nodemailer";

// Security emails to the account owner. Best effort: a failed or unconfigured
// mailer never blocks the action that triggered it. Uses the same SMTP_* env
// vars as statement emails.

const MESSAGES = {
  passkey_added: (d) => ({
    subject: "A new passkey was added to your Starlit Pay account",
    text: `A passkey named "${d.deviceName || "Passkey"}" was added to your account.${
      d.pending ? " Because it was added with your recovery code, it becomes active in 24 hours." : ""
    }\n\nIf this wasn't you, sign in and remove it under Settings > Security, then contact support@starlitpay.xyz.`,
  }),
  recovery_used: () => ({
    subject: "Your Starlit Pay recovery code was used",
    text: "Your recovery code was just used to unlock your wallet. That code no longer works; a new one is created during recovery.\n\nIf this wasn't you, contact support@starlitpay.xyz immediately.",
  }),
  pin_locked: (d) => ({
    subject: "Too many incorrect PINs on your Starlit Pay account",
    text: `Your PIN was entered incorrectly too many times, so PIN unlock is paused for ${Math.ceil(
      (d.lockSeconds ?? 900) / 60
    )} minutes.\n\nIf this wasn't you, someone may know your email address. Your wallet stays safe; consider changing your PIN under Settings > Security.`,
  }),
  keys_migrated: () => ({
    subject: "Your Starlit Pay wallet was upgraded to passkeys",
    text: "Your wallet now uses new keys protected by your passkey, PIN and recovery code, and your funds were moved to them. Your old PIN-only sign-in no longer works.\n\nIf this wasn't you, contact support@starlitpay.xyz immediately.",
  }),
};

export function createEmailAlerts(env = process.env) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env;
  const transport =
    SMTP_HOST && SMTP_USER && SMTP_PASS
      ? nodemailer.createTransport({
          host: SMTP_HOST,
          port: Number(SMTP_PORT || 587),
          secure: Number(SMTP_PORT || 587) === 465,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        })
      : null;

  return {
    async send(user, event, details = {}) {
      const build = MESSAGES[event];
      if (!transport || !build || !user?.email) return;
      const { subject, text } = build(details);
      try {
        await transport.sendMail({ from: env.SMTP_FROM || SMTP_USER, to: user.email, subject, text });
      } catch (err) {
        console.error(`[AUTH-ALERTS] Could not send ${event} email: ${err.message}`);
      }
    },
  };
}

/** No-op alerts (tests, or when email is not configured). */
export const noAlerts = { async send() {} };
