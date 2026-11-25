// Email through Resend (https://resend.com). Without RESEND_API_KEY nothing is
// sent: approval still works, and the applicant's status page shows the news.

export function createResendMailer({ apiKey, from, fetchImpl = fetch, logger }) {
  return {
    enabled: Boolean(apiKey),

    /** Resolves to true if Resend accepted the email. Never throws. */
    async send({ to, subject, html, text }) {
      if (!apiKey) return false;
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, html, text }),
        });
        if (!res.ok) {
          logger?.warn?.({ status: res.status }, "Email was not accepted by Resend.");
          return false;
        }
        return true;
      } catch (err) {
        logger?.warn?.({ err: err?.message }, "Email could not be sent.");
        return false;
      }
    },
  };
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The "You're in" email for an approved Founding Tester. */
export function approvalEmail({ name, email, appUrl, telegramUrl }) {
  const signIn = `${appUrl}/auth`;
  const text = [
    `Hi ${name},`,
    "",
    "You're in! Welcome to the Starlit Pay closed beta as a Founding Tester.",
    "",
    `1. Sign in with Google using ${email}: ${signIn}`,
    "   (no invite code needed: your email is already approved)",
    ...(telegramUrl ? [`2. Join the Founding Testers group: ${telegramUrl}`] : []),
    `${telegramUrl ? 3 : 2}. Claim free test funds and send your first private payment.`,
    "",
    "Once you're in, you'll find 3 golden tickets on your Dashboard to invite friends.",
    "",
    "Starlit Pay runs on the Stellar test network: test funds only, no real money.",
    "",
    "Welcome aboard,",
    "The Starlit Pay team",
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#13233f;max-width:560px">
  <p>Hi ${escape(name)},</p>
  <p><strong>You're in!</strong> Welcome to the Starlit Pay closed beta as a Founding Tester.</p>
  <ol>
    <li>Sign in with Google using <strong>${escape(email)}</strong>. No invite code needed: your email is already approved.</li>
    ${telegramUrl ? `<li>Join the <a href="${escape(telegramUrl)}">Founding Testers group on Telegram</a>.</li>` : ""}
    <li>Claim free test funds and send your first private payment.</li>
  </ol>
  <p><a href="${escape(signIn)}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold">Open Starlit Pay</a></p>
  <p>Once you're in, you'll find <strong>3 golden tickets</strong> on your Dashboard to invite friends.</p>
  <p style="color:#5b6b82;font-size:13px">Starlit Pay runs on the Stellar test network: test funds only, no real money.</p>
  <p>Welcome aboard,<br/>The Starlit Pay team</p>
</div>`;

  return { subject: "You're in: welcome to the Starlit Pay beta", text, html };
}
