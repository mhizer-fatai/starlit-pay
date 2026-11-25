import crypto from "node:crypto";
import { HttpError } from "../../http/errors.js";
import { approvalEmail } from "./mailer.js";

// Closed beta ("Founding Testers"). While sign-up is invite-only, a new
// account gets in one of two ways:
//   - its Google email belongs to an approved application (people who found
//     Starlit elsewhere, e.g. on X, apply; approval emails them "you're in"), or
//   - it enters an invite code:
//       group   many uses, shared in a community (e.g. a WhatsApp group)
//       golden  one use, three per tester, to invite friends

export const GOLDEN_TICKETS_PER_USER = 3;
const MAX_CAS_ATTEMPTS = 5;

// No 0/O, 1/I/L: codes get read out and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `STAR-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Codes are typed by hand: accept lowercase and missing dashes. */
export function normalizeInviteCode(input) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("STAR") ? raw.slice(4) : raw;
  return body.length === 8 ? `STAR-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

const newStatusToken = (randomBytes = crypto.randomBytes) => randomBytes(24).toString("base64url");

export function createBetaService({
  repository,
  inviteOnly = false,
  adminEmails = [],
  telegramUrl = null,
  appUrl = "https://starlitpay.xyz",
  mailer = { enabled: false, send: async () => false },
  verifyCaptcha = async () => {},
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
}) {
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));

  async function createInvite(fields) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const invite = await repository.insertInvite({ code: newInviteCode(randomBytes), ...fields });
      if (invite) return invite;
    }
    throw new Error("Could not create a unique invite code.");
  }

  const usable = (invite) => invite && !invite.revoked_at && invite.uses < invite.max_uses;

  return {
    inviteOnly,

    isAdmin(email) {
      return admins.has(String(email ?? "").toLowerCase());
    },

    /**
     * Takes one use of a code before the account is created. Throws a 400 the
     * sign-up page can show. Pair with release() if the account isn't created.
     */
    async reserve(input) {
      const code = normalizeInviteCode(input);
      if (!code) throw new HttpError(400, "Starlit Pay is in a closed beta. Enter your invite code to sign up.", "invite_required");
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const invite = await repository.findInvite(code);
        if (!usable(invite)) throw new HttpError(400, "That invite code isn't valid or has already been used.", "invite_invalid");
        if (await repository.setInviteUses(code, invite.uses, invite.uses + 1)) return code;
      }
      throw new HttpError(409, "That invite code is busy. Please try again.", "invite_busy");
    },

    /** Gives back a use taken by reserve() when sign-up failed. */
    async release(code) {
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const invite = await repository.findInvite(code);
        if (!invite || invite.uses === 0) return;
        if (await repository.setInviteUses(code, invite.uses, invite.uses - 1)) return;
      }
    },

    /**
     * Lets a new account in while sign-up is invite-only. An approved email
     * needs no code (returns null); anyone else takes a use of their code.
     */
    async admit(email, inviteCode) {
      if (await repository.isApprovedEmail(String(email ?? "").toLowerCase())) return null;
      return this.reserve(inviteCode);
    },

    /** Whether this (Google-verified) email can sign up without a code. */
    async isApproved(email) {
      return repository.isApprovedEmail(String(email ?? "").toLowerCase());
    },

    async redeemed(code, userId) {
      await repository.recordRedemption(code, userId);
    },

    /** A tester's golden tickets (created on first look), with which ones were used. */
    async goldenTickets(userId) {
      let tickets = await repository.invitesOwnedBy(userId);
      for (let i = tickets.length; i < GOLDEN_TICKETS_PER_USER; i++) {
        tickets.push(await createInvite({ kind: "golden", owner_id: userId, max_uses: 1 }));
      }
      tickets = tickets.slice(0, GOLDEN_TICKETS_PER_USER);
      const used = new Set((await repository.redemptionsOf(tickets.map((t) => t.code))).map((r) => r.code));
      return tickets.map((t) => ({ code: t.code, used: used.has(t.code) || t.uses >= t.max_uses }));
    },

    async apply(input, captchaToken) {
      await verifyCaptcha(captchaToken);
      const statusToken = newStatusToken(randomBytes);
      const application = await repository.insertApplication({
        status_token: statusToken,
        name: input.name,
        email: input.email,
        x_handle: input.x_handle || null,
        telegram_handle: input.telegram_handle || null,
        persona: input.persona,
        reason: input.reason,
      });
      // An email that already applied gets no new link: its first one still works.
      if (!application) return { received: true, statusToken: null };
      return { received: true, statusToken };
    },

    async status(token) {
      const application = await repository.findApplicationByToken(token);
      if (!application) throw new HttpError(404, "We couldn't find that application.");
      const approved = application.status === "approved";
      return {
        name: application.name,
        status: application.status,
        email: approved ? application.email : null,
        telegramUrl: approved ? telegramUrl : null,
      };
    },

    async listApplications(status) {
      return repository.listApplications(status);
    },

    /** Approves the application's email and tells them by email (if a sender is set up). */
    async approve(id) {
      const application = await repository.reviewApplication(id, { status: "approved", reviewed_at: now().toISOString() });
      if (!application) throw new HttpError(409, "That application was already reviewed.");
      const emailed = await mailer.send({
        to: application.email,
        ...approvalEmail({ name: application.name, email: application.email, appUrl, telegramUrl }),
      });
      return { application, emailed };
    },

    async reject(id) {
      const application = await repository.reviewApplication(id, { status: "rejected", reviewed_at: now().toISOString() });
      if (!application) throw new HttpError(409, "That application was already reviewed.");
      return application;
    },

    /** A shareable code for a community, e.g. "Web3 Lagos WhatsApp", usable maxUses times. */
    async createGroupInvite({ label, maxUses }) {
      return createInvite({ kind: "group", label, max_uses: maxUses });
    },

    async listGroupInvites() {
      return repository.listInvites(["group"]);
    },

    async revoke(code) {
      if (!(await repository.revokeInvite(code, now().toISOString()))) throw new HttpError(404, "No active invite with that code.");
    },
  };
}
