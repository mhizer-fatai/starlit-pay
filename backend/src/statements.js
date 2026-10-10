import nodemailer from "nodemailer";
import { app } from "./config.js";
import { requireAuth } from "./auth.js";

// Emails a generated account statement to the authenticated user's OWN inbox
// address only (never an arbitrary recipient — this must not become an open
// relay). Configure via SMTP_* env vars; without them the endpoint reports
// 503 and the frontend says so honestly.

const MAX_BYTES = 5 * 1024 * 1024;

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

app.post("/api/statements/email", requireAuth, async (req, res) => {
  const { filename, mime, contentBase64, subject } = req.body ?? {};

  if (typeof filename !== "string" || !filename || filename.length > 120) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  if (mime !== "application/pdf" && mime !== "application/vnd.ms-excel") {
    return res.status(400).json({ error: "Invalid file type." });
  }
  if (typeof contentBase64 !== "string" || !contentBase64) {
    return res.status(400).json({ error: "Missing file content." });
  }
  let buffer;
  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid file content." });
  }
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: "File is empty or too large." });
  }

  const transport = mailer();
  if (!transport) {
    return res.status(503).json({ error: "Email service is not configured." });
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: req.user.email,
      subject:
        typeof subject === "string" && subject
          ? subject.slice(0, 120)
          : "Your Starlit Pay statement",
      text: "Your requested Starlit Pay account statement is attached.",
      attachments: [{ filename, content: buffer, contentType: mime }],
    });
    res.status(200).json({ sent: true, to: req.user.email });
  } catch (error) {
    console.error("Statement email error:", error.message);
    res.status(502).json({ error: "Failed to send email. Please try again later." });
  }
});
