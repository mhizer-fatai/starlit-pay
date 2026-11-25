import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Check, Clock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchBetaStatus } from "@/lib/backend";
import { container } from "@/lib/utils";

type Status = Awaited<ReturnType<typeof fetchBetaStatus>>;

/** An applicant's private status page: pending, or their invite code and the group. */
function BetaStatusPage() {
  const { token = "" } = useParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Your beta application — Starlit Pay";
    let cancelled = false;
    fetchBetaStatus(token)
      .then((s) => !cancelled && setStatus(s))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "We couldn't load your application."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />
      <main className={`${container} py-20 lg:py-28`}>
        <div className="mx-auto max-w-[640px] rounded-md border border-border bg-background/60 p-8 sm:p-10">
          {error && <p className="text-[16px] text-destructive">{error}</p>}
          {!status && !error && <p className="text-[16px] text-foreground/70">Loading…</p>}

          {status?.status === "pending" && (
            <>
              <Clock className="size-8 text-primary" aria-hidden="true" />
              <h1 className="mt-4 text-[28px] font-medium text-foreground">Thanks, {status.name}. You're on the list.</h1>
              <p className="mt-3 text-[15px] leading-[1.7] text-foreground/75">
                We review applications by hand and add Founding Testers in small groups. We'll email you when
                you're approved, and this page will show how to get in.
              </p>
            </>
          )}

          {status?.status === "rejected" && (
            <>
              <X className="size-8 text-foreground/60" aria-hidden="true" />
              <h1 className="mt-4 text-[28px] font-medium text-foreground">Not this round</h1>
              <p className="mt-3 text-[15px] leading-[1.7] text-foreground/75">
                Thanks for your interest, {status.name}. We couldn't fit you into this group of testers, but
                Starlit Pay will open to everyone at launch. Follow us on X to hear first.
              </p>
            </>
          )}

          {status?.status === "approved" && (
            <>
              <Check className="size-8 text-primary" aria-hidden="true" />
              <h1 className="mt-4 text-[28px] font-medium text-foreground">You're in, {status.name}!</h1>
              <p className="mt-3 text-[15px] leading-[1.7] text-foreground/75">
                Welcome to Starlit Pay as a Founding Tester. No invite code needed: your email is approved.
              </p>
              <ol className="mt-6 grid gap-2 text-[15px] leading-[1.7] text-foreground/80">
                <li>
                  1. Sign in with Google using <strong className="text-foreground">{status.email}</strong>.
                </li>
                {status.telegramUrl && (
                  <li>
                    2. Join the{" "}
                    <a href={status.telegramUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                      Founding Testers group on Telegram
                    </a>
                    .
                  </li>
                )}
                <li>{status.telegramUrl ? 3 : 2}. Claim test funds and send your first private payment.</li>
              </ol>
              <p className="mt-4 text-[14px] text-foreground/70">
                Once you're in, you'll find 3 golden tickets on your Dashboard to invite friends.
              </p>
              <Button asChild className="cta-shadow mt-8 h-12 rounded px-5 text-[15px]">
                <Link to="/auth">
                  Sign in with Google <ArrowRight />
                </Link>
              </Button>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default BetaStatusPage;
