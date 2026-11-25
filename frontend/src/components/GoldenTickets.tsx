import { useEffect, useState } from "react";
import { Check, Copy, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchBetaConfig, fetchBetaMe } from "@/lib/backend";

type Tickets = { code: string; used: boolean }[];

const inviteLink = (code: string) => `${window.location.origin}/auth?invite=${encodeURIComponent(code)}`;

/** A Founding Tester's three invites. Shown only while sign-up is invite-only. */
export function GoldenTickets() {
  const [tickets, setTickets] = useState<Tickets | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { inviteOnly } = await fetchBetaConfig();
        if (!inviteOnly) return;
        const me = await fetchBetaMe();
        if (!cancelled) setTickets(me.tickets);
      } catch {
        /* the card simply doesn't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tickets) return null;
  const left = tickets.filter((t) => !t.used).length;

  return (
    <section className="dash-card" aria-label="Golden tickets">
      <div className="card-title-row">
        <span className="flex items-center gap-2">
          <Ticket className="size-4 text-primary" aria-hidden="true" /> Golden tickets
        </span>
        <span className="text-sm text-muted-foreground">{left} of {tickets.length} left</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Invite friends to the closed beta. Each link works once and lets them skip the queue.
      </p>
      <ul className="mt-4 grid gap-2">
        {tickets.map((t) => (
          <li key={t.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <code className={`text-sm font-semibold ${t.used ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.code}</code>
            {t.used ? (
              <span className="text-sm text-muted-foreground">Used</span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteLink(t.code));
                  setCopied(t.code);
                }}
              >
                {copied === t.code ? <Check /> : <Copy />} {copied === t.code ? "Link copied" : "Copy invite link"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
