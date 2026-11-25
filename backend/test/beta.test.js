import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createBetaService, GOLDEN_TICKETS_PER_USER, newInviteCode, normalizeInviteCode } from "../src/modules/beta/service.js";
import { applyRequest } from "../src/modules/beta/routes.js";
import { approvalEmail, createResendMailer } from "../src/modules/beta/mailer.js";
import { createUsersService } from "../src/modules/users/service.js";

function memoryRepo() {
  const invites = new Map();
  const redemptions = [];
  const applications = [];
  return {
    invites,
    redemptions,
    applications,
    async findInvite(code) {
      const invite = invites.get(code);
      return invite ? { ...invite } : null;
    },
    async insertInvite(invite) {
      if (invites.has(invite.code)) return null;
      const row = { uses: 0, max_uses: 1, revoked_at: null, owner_id: null, created_at: new Date().toISOString(), ...invite };
      invites.set(invite.code, row);
      return { ...row };
    },
    async setInviteUses(code, from, to) {
      const invite = invites.get(code);
      if (!invite || invite.uses !== from) return false;
      invite.uses = to;
      return true;
    },
    async invitesOwnedBy(ownerId) {
      return [...invites.values()].filter((i) => i.owner_id === ownerId).map((i) => ({ ...i }));
    },
    async listInvites(kinds) {
      return [...invites.values()].filter((i) => kinds.includes(i.kind));
    },
    async revokeInvite(code, at) {
      const invite = invites.get(code);
      if (!invite || invite.revoked_at) return false;
      invite.revoked_at = at;
      return true;
    },
    async recordRedemption(code, userId) {
      redemptions.push({ code, user_id: userId });
    },
    async redemptionsOf(codes) {
      return redemptions.filter((r) => codes.includes(r.code));
    },
    async insertApplication(application) {
      if (applications.some((a) => a.email === application.email)) return null;
      const row = { id: crypto.randomUUID(), status: "pending", invite_code: null, ...application };
      applications.push(row);
      return row;
    },
    async findApplicationByToken(token) {
      return applications.find((a) => a.status_token === token) ?? null;
    },
    async isApprovedEmail(email) {
      return applications.some((a) => a.email === email && a.status === "approved");
    },
    async listApplications(status) {
      return applications.filter((a) => !status || a.status === status);
    },
    async reviewApplication(id, fields) {
      const application = applications.find((a) => a.id === id && a.status === "pending");
      if (!application) return null;
      Object.assign(application, fields);
      return application;
    },
  };
}

const rejects = (promise, status, code) =>
  assert.rejects(promise, (err) => err.status === status && (!code || err.code === code));

const application = (overrides = {}) => ({
  name: "Ada",
  email: "ada@gmail.com",
  x_handle: "ada",
  telegram_handle: "ada_tg",
  persona: "freelancer",
  reason: "I get paid by clients abroad.",
  ...overrides,
});

test("invite codes are readable and typed codes are normalized", () => {
  const code = newInviteCode();
  assert.match(code, /^STAR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizeInviteCode(code.toLowerCase().replace(/-/g, "")), code);
  assert.equal(normalizeInviteCode(` ${code.slice(5)} `), code, "the STAR- prefix is optional");
  assert.equal(normalizeInviteCode("nope"), null);
});

test("a group code works up to its limit; revoked codes stop working", async () => {
  const repo = memoryRepo();
  const beta = createBetaService({ repository: repo });
  const { code } = await beta.createGroupInvite({ label: "Web3 Lagos", maxUses: 2 });
  await beta.reserve(code);
  await beta.reserve(code.toLowerCase());
  await rejects(beta.reserve(code), 400, "invite_invalid");

  const other = await beta.createGroupInvite({ label: "Chapter", maxUses: 5 });
  await beta.revoke(other.code);
  await rejects(beta.reserve(other.code), 400, "invite_invalid");
  await rejects(beta.reserve(""), 400, "invite_required");
});

test("two people racing for the last use: only one wins", async () => {
  const repo = memoryRepo();
  const beta = createBetaService({ repository: repo });
  const { code } = await beta.createGroupInvite({ label: "last seat", maxUses: 1 });
  const results = await Promise.allSettled([beta.reserve(code), beta.reserve(code)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(repo.invites.get(code).uses, 1);
});

function usersRepo() {
  const users = [];
  return {
    users,
    async depositMemoTaken() {
      return false;
    },
    async insert(user) {
      if (users.some((u) => u.username === user.username || u.email === user.email)) return null;
      const row = { id: crypto.randomUUID(), ...user };
      users.push(row);
      return row;
    },
  };
}

const signup = (overrides = {}) => ({
  email: "bob@example.com",
  username: "bob",
  identity_commitment: "ab".repeat(32),
  public_encryption_key: "cd".repeat(32),
  ...overrides,
});

test("while invite-only, sign-up needs a code; a failed sign-up gives the use back", async () => {
  const repo = memoryRepo();
  const beta = createBetaService({ repository: repo, inviteOnly: true });
  const accounts = usersRepo();
  const users = createUsersService({ repository: accounts, emailProofRequired: false, beta });
  const { code } = await beta.createGroupInvite({ label: "WhatsApp", maxUses: 2 });

  await rejects(users.register(signup(), null), 400, "invite_required");
  const bob = await users.register(signup({ invite_code: code }), null);
  assert.deepEqual(repo.redemptions, [{ code, user_id: bob.id }]);

  // Username taken: the account isn't created and the code's use is returned.
  await rejects(users.register(signup({ email: "other@example.com", invite_code: code }), null), 400);
  assert.equal(repo.invites.get(code).uses, 1);
});

test("open sign-up ignores invite codes", async () => {
  const beta = createBetaService({ repository: memoryRepo(), inviteOnly: false });
  const users = createUsersService({ repository: usersRepo(), emailProofRequired: false, beta });
  assert.ok((await users.register(signup(), null)).id);
});

test("each tester gets three golden tickets, and used ones are marked", async () => {
  const repo = memoryRepo();
  const beta = createBetaService({ repository: repo, inviteOnly: true });
  const tickets = await beta.goldenTickets("tester-1");
  assert.equal(tickets.length, GOLDEN_TICKETS_PER_USER);
  assert.deepEqual((await beta.goldenTickets("tester-1")).map((t) => t.code), tickets.map((t) => t.code), "stable on every look");

  const users = createUsersService({ repository: usersRepo(), emailProofRequired: false, beta });
  await users.register(signup({ invite_code: tickets[0].code }), null);
  const after = await beta.goldenTickets("tester-1");
  assert.deepEqual(after.map((t) => t.used), [true, false, false]);
  await rejects(beta.reserve(tickets[0].code), 400, "invite_invalid");
});

test("an approved Gmail signs up with no code; anyone else still needs one", async () => {
  const repo = memoryRepo();
  const beta = createBetaService({ repository: repo, inviteOnly: true });
  const users = createUsersService({ repository: usersRepo(), emailProofRequired: false, beta });
  await beta.apply(application());
  const [row] = await beta.listApplications("pending");

  await rejects(users.register(signup({ email: "ada@gmail.com", username: "ada" }), null), 400, "invite_required");
  await beta.approve(row.id);
  assert.equal(await beta.isApproved("ADA@gmail.com"), true);
  const ada = await users.register(signup({ email: "ada@gmail.com", username: "ada" }), null);
  assert.ok(ada.id);
  assert.equal(repo.redemptions.length, 0, "no code was used");

  await rejects(users.register(signup({ email: "stranger@gmail.com", username: "stranger" }), null), 400, "invite_required");
});

test("approval emails the applicant once; the status page shows how to get in", async () => {
  const sent = [];
  const mailer = { enabled: true, send: async (mail) => (sent.push(mail), true) };
  const beta = createBetaService({ repository: memoryRepo(), telegramUrl: "https://t.me/+founders", appUrl: "https://starlitpay.xyz", mailer });
  const { statusToken } = await beta.apply(application());

  const pending = await beta.status(statusToken);
  assert.equal(pending.status, "pending");
  assert.equal(pending.telegramUrl, null, "the group link stays hidden until approval");

  const [row] = await beta.listApplications("pending");
  const { emailed } = await beta.approve(row.id);
  assert.equal(emailed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ada@gmail.com");
  assert.ok(sent[0].text.includes("Sign in with Google using ada@gmail.com"));
  assert.ok(sent[0].html.includes("https://t.me/+founders"));

  const approved = await beta.status(statusToken);
  assert.equal(approved.status, "approved");
  assert.equal(approved.email, "ada@gmail.com");
  assert.equal(approved.telegramUrl, "https://t.me/+founders");

  await rejects(beta.approve(row.id), 409);
  assert.equal(sent.length, 1, "no second email");
});

test("without a mail key nothing is sent, and approval still works", async () => {
  const fetchImpl = async () => assert.fail("should not call Resend");
  const mailer = createResendMailer({ apiKey: undefined, from: "x", fetchImpl });
  assert.equal(await mailer.send({ to: "a@gmail.com", subject: "s", text: "t", html: "h" }), false);

  const beta = createBetaService({ repository: memoryRepo(), mailer });
  await beta.apply(application());
  const [row] = await beta.listApplications();
  assert.equal((await beta.approve(row.id)).emailed, false);
});

test("Resend is called with the key, and a refusal is reported, not thrown", async () => {
  const calls = [];
  const ok = createResendMailer({ apiKey: "re_test", from: "Starlit <hi@starlitpay.xyz>", fetchImpl: async (url, init) => (calls.push({ url, init }), { ok: true }) });
  assert.equal(await ok.send({ to: "a@gmail.com", ...approvalEmail({ name: "<Ada>", email: "a@gmail.com", appUrl: "https://x", telegramUrl: null }) }), true);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test");
  assert.ok(!JSON.parse(calls[0].init.body).html.includes("<Ada>"), "names are escaped in the email");

  const refused = createResendMailer({ apiKey: "re_test", from: "x", fetchImpl: async () => ({ ok: false, status: 422 }) });
  assert.equal(await refused.send({ to: "a@gmail.com", subject: "s", text: "t", html: "h" }), false);
});

test("rejected applicants get no access and no group link", async () => {
  const beta = createBetaService({ repository: memoryRepo(), inviteOnly: true, telegramUrl: "https://t.me/+founders" });
  const { statusToken } = await beta.apply(application({ email: "eve@gmail.com" }));
  const [eve] = await beta.listApplications("pending");
  await beta.reject(eve.id);
  const status = await beta.status(statusToken);
  assert.equal(status.status, "rejected");
  assert.equal(status.telegramUrl, null);
  assert.equal(await beta.isApproved("eve@gmail.com"), false);
});

test("applying twice with one email gives no second link; captcha is checked", async () => {
  const beta = createBetaService({ repository: memoryRepo() });
  assert.ok((await beta.apply(application())).statusToken);
  assert.deepEqual(await beta.apply(application()), { received: true, statusToken: null });

  const strict = createBetaService({
    repository: memoryRepo(),
    verifyCaptcha: async (token) => {
      if (token !== "ok") throw Object.assign(new Error("captcha"), { status: 403 });
    },
  });
  await rejects(strict.apply(application(), "bad"), 403);
});

test("only listed admin emails are admins", () => {
  const beta = createBetaService({ repository: memoryRepo(), adminEmails: [" Founder@Example.com ", ""] });
  assert.equal(beta.isAdmin("founder@example.com"), true);
  assert.equal(beta.isAdmin("someone@example.com"), false);
  assert.equal(beta.isAdmin(undefined), false);
});

test("the application form validates its fields", () => {
  assert.equal(applyRequest.safeParse({ ...application(), x_handle: "@ada" }).data.x_handle, "ada");
  assert.equal(applyRequest.safeParse({ ...application(), persona: "whale" }).success, false);
  assert.equal(applyRequest.safeParse({ ...application(), reason: "" }).success, false);
  assert.equal(applyRequest.safeParse({ ...application(), email: "not-an-email" }).success, false);
  assert.equal(applyRequest.safeParse({ ...application(), email: "ada@outlook.com" }).success, false, "Gmail only for now");
  assert.equal(applyRequest.safeParse({ ...application(), email: "ada@gmailxcom.net" }).success, false);
  assert.equal(applyRequest.safeParse({ ...application(), email: "Ada@GoogleMail.com" }).data.email, "ada@googlemail.com");
});
