import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Starts the real server, every module wired together. Unit tests load modules
// one at a time, so a broken import or startup crash only shows up here.
// Runs outside the backend folder so no .env (and no real key) is loaded.

const server = path.resolve(import.meta.dirname, "../server.js");

test("the whole server starts and answers", async (t) => {
  const port = 3900 + Math.floor(Math.random() * 90);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "starlit-boot-"));
  const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PORT: String(port), BACKGROUND_JOBS: "off", LOG_FORMAT: "json", SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "test" };
  const child = spawn(process.execPath, [server], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());

  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const listening = new Promise((resolve) => {
    const check = setInterval(() => output.includes("listening on port") && (clearInterval(check), resolve()), 50);
  });
  const outcome = await Promise.race([listening.then(() => "up"), exited.then((code) => `exited ${code}`), new Promise((r) => setTimeout(() => r("timeout"), 15_000))]);
  assert.equal(outcome, "up", output);

  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  const post = (p) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "starlit" }, body: "{}" });
  // Each module is mounted (a missing one would answer 404).
  assert.equal((await post("/api/notes")).status, 401);
  assert.equal((await post("/api/faucet/fund")).status, 401);
  assert.equal((await post("/api/relayer/withdraw")).status, 401);
  assert.equal((await post("/api/gateway/deposit")).status, 400);
  assert.equal((await fetch(`${base}/api/relayer/daemon/status`)).status, 200);
  // The claim route had no caller and is gone.
  assert.equal((await post("/api/relayer/submit")).status, 404);
});
