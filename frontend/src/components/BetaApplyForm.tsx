import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

import { Button } from "@/components/ui/button";
import { applyToBeta, type BetaPersona } from "@/lib/backend";

const PERSONAS: { value: BetaPersona; label: string }[] = [
  { value: "freelancer", label: "Freelancer or remote worker" },
  { value: "business", label: "Small business owner" },
  { value: "crypto", label: "Crypto user" },
  { value: "developer", label: "Developer" },
  { value: "other", label: "Something else" },
];

const field =
  "mt-2 block w-full min-w-0 rounded-md border border-border bg-background px-3 py-2.5 text-[16px] text-foreground outline-none transition-colors focus:border-primary sm:px-4 sm:py-3";
const label = "text-[14px] font-semibold text-foreground";

const statusLink = (token: string) => `${window.location.origin}/beta/${token}`;

/** "Join the beta" application for people who don't have an invite code yet. */
export function BetaApplyForm() {
  const [form, setForm] = useState({ name: "", email: "", x_handle: "", telegram_handle: "", persona: "" as BetaPersona | "", reason: "" });
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ token: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/@(gmail|googlemail)\.com$/i.test(form.email.trim())) {
      return setError("Use your Gmail address: it's the one you'll sign in with.");
    }
    if (!form.persona) return setError("Tell us what best describes you.");
    if (!captchaToken) return setError("Please complete the quick check below.");
    setBusy(true);
    setError("");
    try {
      const { statusToken } = await applyToBeta({
        name: form.name,
        email: form.email,
        x_handle: form.x_handle || undefined,
        telegram_handle: form.telegram_handle || undefined,
        persona: form.persona,
        reason: form.reason,
        captchaToken,
      });
      setDone({ token: statusToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setCaptchaToken("");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-[880px] rounded-md border border-primary/25 bg-primary/5 p-5 sm:p-8">
        <p className="text-[20px] font-semibold text-foreground">Thanks for applying!</p>
        {done.token ? (
          <>
            <p className="mt-2 text-[15px] leading-[1.7] text-foreground/75">
              We'll email you when you're approved. You can also check this link any time; save it.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <code className="rounded bg-background px-3 py-2 text-[14px] break-all">{statusLink(done.token)}</code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(statusLink(done.token!));
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[15px] leading-[1.7] text-foreground/75">
            We already have an application from this email. Use the status link you saved when you first
            applied.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid w-full max-w-[880px] grid-cols-1 gap-4 rounded-md border border-border bg-background/60 p-4 sm:grid-cols-2 sm:gap-5 sm:p-6 lg:p-8">
      <label className="block min-w-0">
        <span className={label}>Name</span>
        <input className={field} value={form.name} onChange={set("name")} maxLength={100} required disabled={busy} />
      </label>
      <label className="block min-w-0">
        <span className={label}>Gmail address</span>
        <input className={field} type="email" placeholder="you@gmail.com" value={form.email} onChange={set("email")} maxLength={254} required disabled={busy} />
        <span className="mt-1 block text-[12px] text-foreground/60">The Google account you'll sign in with. If you're approved, it gets you in.</span>
      </label>
      <label className="block min-w-0">
        <span className={label}>X handle</span>
        <input className={field} placeholder="@yourhandle" value={form.x_handle} onChange={set("x_handle")} maxLength={32} disabled={busy} />
      </label>
      <label className="block min-w-0">
        <span className={label}>Telegram username</span>
        <input className={field} placeholder="@yourname" value={form.telegram_handle} onChange={set("telegram_handle")} maxLength={64} disabled={busy} />
      </label>
      <label className="block sm:col-span-2">
        <span className={label}>What best describes you?</span>
        <select className={field} value={form.persona} onChange={set("persona")} required disabled={busy}>
          <option value="" disabled>
            Choose one
          </option>
          {PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className={label}>Why do you want private payments?</span>
        <textarea
          className={`${field} min-h-[96px] resize-y`}
          placeholder="One or two lines is plenty."
          value={form.reason}
          onChange={set("reason")}
          minLength={3}
          maxLength={500}
          required
          disabled={busy}
        />
      </label>
      <div className="sm:col-span-2">
        <Turnstile
          ref={turnstileRef}
          siteKey={(import.meta.env.VITE_TURNSTILE_SITE_KEY as string) || "1x00000000000000000000AA"}
          options={{ size: "flexible" }}
          onSuccess={setCaptchaToken}
          onExpire={() => setCaptchaToken("")}
          onError={() => setCaptchaToken("bypass-offline")}
        />
      </div>
      {error && (
        <p className="text-[14px] text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy} className="cta-shadow h-12 w-full rounded px-6 text-[15px] sm:w-auto">
          {busy ? "Sending…" : "Apply to join"}
        </Button>
      </div>
    </form>
  );
}
