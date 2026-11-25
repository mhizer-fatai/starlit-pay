import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { Button } from "@/components/ui/button";
import {
  approveAllBetaApplications,
  approveBetaApplication,
  createGroupInvite,
  fetchBetaMe,
  listBetaApplications,
  listGroupInvites,
  rejectBetaApplication,
  revokeGroupInvite,
  type BetaApplication,
  type BetaInvite,
} from "@/lib/backend";
import { useSidebar } from "@/lib/sidebar";

const PERSONA_LABEL: Record<string, string> = {
  freelancer: "Freelancer / remote",
  business: "Small business",
  crypto: "Crypto user",
  developer: "Developer",
  other: "Other",
};

const inviteLink = (code: string) => `${window.location.origin}/auth?invite=${encodeURIComponent(code)}`;
const field = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

/** Closed beta review: applications to approve, and group codes for communities. */
function AdminBetaPage() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<BetaApplication["status"]>("pending");
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [counts, setCounts] = useState<Record<BetaApplication["status"], number> | null>(null);
  const [invites, setInvites] = useState<BetaInvite[]>([]);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(50);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    const [apps, codes] = await Promise.all([listBetaApplications(tab), listGroupInvites()]);
    setApplications(apps.applications);
    setCounts(apps.counts ?? null);
    setInvites(codes.invites);
  }, [tab]);

  useEffect(() => {
    document.title = "Beta admin — Starlit Pay";
    fetchBetaMe()
      .then((me) => setAllowed(me.admin))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed) void refresh().catch((err) => setError(err instanceof Error ? err.message : "Couldn't load."));
  }, [allowed, refresh]);

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await run();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
  }

  return (
    <div className="dashboard-frame">
      <DashboardSidebar open={mobileOpen} collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setMobileOpen(false)} />
      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="dashboard-main">
        <AppTopbar />
        <PageTransition>
          <main className="dashboard-content">
            {allowed === false && (
              <section className="dash-card" style={{ height: "auto", minHeight: 0 }}>
                <p className="text-sm text-muted-foreground">Admins only.</p>
              </section>
            )}

            {allowed && (
              <>
                {error && (
                  <p className="text-sm text-red-500" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="text-sm text-foreground" role="status">
                    {notice}
                  </p>
                )}

                <section className="dash-card" style={{ height: "auto", minHeight: 0 }}>
                  <div className="card-title-row flex-wrap gap-2">
                    <span>Applications</span>
                    <div className="flex flex-wrap gap-1">
                      {(["pending", "approved", "rejected"] as const).map((s) => (
                        <Button key={s} type="button" size="sm" variant={tab === s ? "default" : "ghost"} onClick={() => setTab(s)}>
                          {s[0].toUpperCase() + s.slice(1)}
                          {counts && (
                            <span className={`ml-1 rounded px-1.5 text-xs font-semibold ${tab === s ? "bg-white/25" : "bg-muted text-muted-foreground"}`}>
                              {counts[s]}
                            </span>
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {tab === "pending" && applications.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        {applications.length} waiting. Approving emails each person their "You're in" message.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => {
                          if (!window.confirm(`Approve all ${applications.length} pending applications? Each one gets the "You're in" email.`)) return;
                          void act("approve-all", async () => {
                            const { approved, emailed } = await approveAllBetaApplications();
                            setNotice(
                              approved === 0
                                ? "Nothing left to approve."
                                : `Approved ${approved} ${approved === 1 ? "application" : "applications"}. ${emailed} "You're in" ${emailed === 1 ? "email" : "emails"} sent.`
                            );
                          });
                        }}
                      >
                        {busy === "approve-all" ? "Approving all…" : `Approve all (${applications.length})`}
                      </Button>
                    </div>
                  )}
                  {applications.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nothing here yet.</p>}
                  <ul className="mt-3 grid gap-3">
                    {applications.map((a) => (
                      <li key={a.id} className="rounded-md border border-border p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-semibold text-foreground">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {PERSONA_LABEL[a.persona] ?? a.persona} · {a.email}
                          {a.x_handle && (
                            <>
                              {" · "}
                              <a href={`https://x.com/${a.x_handle}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                X: {a.x_handle}
                              </a>
                            </>
                          )}
                          {a.telegram_handle && ` · Telegram: ${a.telegram_handle}`}
                        </p>
                        <p className="mt-2 text-sm text-foreground/85">“{a.reason}”</p>
                        {a.status === "pending" && (
                          <div className="mt-3 flex gap-2">
                            <Button type="button" size="sm" disabled={!!busy} onClick={() =>
                                act(`approve-${a.id}`, async () => {
                                  const { emailed } = await approveBetaApplication(a.id);
                                  setNotice(
                                    emailed
                                      ? `Approved ${a.name}. The "You're in" email went to ${a.email}.`
                                      : `Approved ${a.name}. No email was sent (the mail sender isn't set up yet): tell them to sign in with Google using ${a.email}.`
                                  );
                                })
                              }
                            >
                              {busy === `approve-${a.id}` ? "Approving…" : "Approve"}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => act(`reject-${a.id}`, () => rejectBetaApplication(a.id))}>
                              Reject
                            </Button>
                          </div>
                        )}
                        {a.status === "approved" && (
                          <p className="mt-3 text-sm text-muted-foreground">Approved: signs in with Google using {a.email}.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="dash-card" style={{ height: "auto", minHeight: 0 }}>
                  <div className="card-title-row">
                    <span>Group codes</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    One code for a whole community, e.g. a WhatsApp group. Share the link with the group.
                  </p>
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!label.trim()) return setError("Give the code a label, e.g. the group's name.");
                      void act("create", async () => {
                        await createGroupInvite(label.trim(), maxUses);
                        setLabel("");
                      });
                    }}
                  >
                    <label className="grid gap-1 text-sm">
                      Label
                      <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Web3 Lagos WhatsApp" maxLength={100} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      Uses
                      <input className={`${field} w-24`} type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value) || 1)} />
                    </label>
                    <Button type="submit" size="sm" disabled={!!busy}>
                      {busy === "create" ? "Creating…" : "Create code"}
                    </Button>
                  </form>
                  <ul className="mt-4 grid gap-2">
                    {invites.map((i) => (
                      <li key={i.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                        <span>
                          <code className={`font-semibold ${i.revoked_at ? "line-through text-muted-foreground" : ""}`}>{i.code}</code>{" "}
                          <span className="text-muted-foreground">
                            {i.label} · {i.uses}/{i.max_uses} used{i.revoked_at ? " · revoked" : ""}
                          </span>
                        </span>
                        {!i.revoked_at && (
                          <span className="flex gap-1">
                            <Button type="button" size="sm" variant="ghost" onClick={() => copy(inviteLink(i.code), i.code)}>
                              {copied === i.code ? <Check /> : <Copy />} {copied === i.code ? "Copied" : "Copy link"}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => act(`revoke-${i.code}`, () => revokeGroupInvite(i.code))}>
                              Revoke
                            </Button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default AdminBetaPage;
