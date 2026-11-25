import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Rocket, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchBetaConfig, fetchBetaMe } from "@/lib/backend";
import type { ActivityItem } from "@/lib/wallet";

const dismissKey = (userId: string) => `starlit_onboarding_done_${userId}`;
const readDismissed = (userId: string) => {
  try {
    return localStorage.getItem(dismissKey(userId)) === "1";
  } catch {
    return false;
  }
};

/** A payment to another Starlit user, not a withdrawal or a move between your own balances. */
export const isPrivatePayment = (item: ActivityItem) =>
  item.direction === "out" &&
  !item.transfer &&
  !!item.party &&
  !/^G[A-Z0-9]{55}$/.test(item.party) &&
  !/^[0-9a-fA-F]{20,}$/.test(item.party);

type Step = { title: string; detail: string; done: boolean; action: string; onClick: () => void };

/** First steps for a new tester: get funds, pay someone privately, invite a friend. */
export function GettingStarted({
  userId,
  loading,
  hasFunds,
  sentPrivate,
  onInvite,
}: {
  userId: string;
  /** Balances or history still loading: wait, so finished steps don't flash as undone. */
  loading: boolean;
  hasFunds: boolean;
  sentPrivate: boolean;
  onInvite: () => void;
}) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(true);
  // null = invites aren't part of this beta (open sign-up), or not loaded yet.
  const [invited, setInvited] = useState<boolean | null>(null);

  useEffect(() => {
    if (userId) setDismissed(readDismissed(userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { inviteOnly } = await fetchBetaConfig();
        if (!inviteOnly) return;
        const me = await fetchBetaMe();
        if (!cancelled) setInvited(me.tickets.some((t) => t.used));
      } catch {
        /* the invite step simply doesn't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const steps: Step[] = [
    {
      title: "Claim test funds",
      detail: "Get free test XLM and USDC from the Faucet. They go straight into your private balance.",
      done: hasFunds,
      action: "Open Faucet",
      onClick: () => navigate("/faucet"),
    },
    {
      title: "Send a private payment",
      detail: "Pay any Starlit user by @username. Nobody on the network can see who paid whom, or how much.",
      done: sentPrivate,
      action: "Send",
      onClick: () => navigate("/send"),
    },
  ];
  if (invited !== null) {
    steps.push({
      title: "Invite a friend",
      detail: "Share one of your golden tickets so a friend can join the closed beta.",
      done: invited,
      action: "See my tickets",
      onClick: onInvite,
    });
  }

  const doneCount = steps.filter((s) => s.done).length;
  if (!userId || loading || dismissed || doneCount === steps.length) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(userId), "1");
    } catch {
      /* storage unavailable: it shows again next visit */
    }
  }

  return (
    <section className="dash-card" aria-label="Get started">
      <div className="card-title-row">
        <span className="flex items-center gap-2">
          <Rocket className="size-4 text-primary" aria-hidden="true" /> Get started
        </span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {doneCount} of {steps.length} done
          <button type="button" onClick={dismiss} aria-label="Hide get started" className="rounded p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 grid gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                step.done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
              }`}
              aria-hidden="true"
            >
              {step.done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block font-semibold ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : ""}</span>
              </span>
              <span className="block text-sm text-muted-foreground">{step.detail}</span>
            </span>
            {!step.done && (
              <Button type="button" size="sm" variant="secondary" onClick={step.onClick}>
                {step.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
