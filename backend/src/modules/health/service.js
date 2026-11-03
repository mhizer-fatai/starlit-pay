// One health answer for uptime monitoring. Each check reports ok, warn or
// fail; a check that hangs counts as a failure. The service is "down" (503)
// only when payments can't work: database, RPC or relayer failing. Anything
// else that needs attention makes it "degraded".

const CRITICAL = new Set(["database", "rpc", "relayer"]);

export function createHealthService({ checks, timeoutMs = 5_000, cacheMs = 10_000, now = Date.now }) {
  let cached = null;

  const withTimeout = (run) =>
    Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs).unref?.()),
    ]);

  async function runCheck(name, run) {
    const startedAt = now();
    try {
      const result = await withTimeout(run);
      return [name, { status: "ok", ...result, latencyMs: now() - startedAt }];
    } catch (err) {
      // The message stays generic: health output is public.
      return [name, { status: "fail", error: err?.message === "timed out" ? "timed out" : "check failed", latencyMs: now() - startedAt }];
    }
  }

  return {
    async report() {
      if (cached && now() - cached.at < cacheMs) return cached.report;
      const results = Object.fromEntries(await Promise.all(Object.entries(checks).map(([name, run]) => runCheck(name, run))));
      const entries = Object.entries(results);
      const status = entries.some(([name, r]) => r.status === "fail" && CRITICAL.has(name))
        ? "down"
        : entries.some(([, r]) => r.status !== "ok" && r.status !== "off")
          ? "degraded"
          : "ok";
      const report = { status, checkedAt: new Date(now()).toISOString(), checks: results };
      cached = { report, at: now() };
      return report;
    },
  };
}
