import { useState } from "react";
import { Check, Copy, Download, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shows a freshly generated recovery code exactly once. The user must confirm
 * they saved it before continuing; it cannot be shown again.
 */
export function RecoveryCodePanel({
  code,
  onDone,
  doneLabel = "Continue",
}: {
  code: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const text = [
      "Starlit Pay recovery code",
      "",
      code,
      "",
      "Keep this somewhere safe and private. It is the only way back into your",
      "wallet if you lose every passkey and forget your PIN. Starlit Pay cannot",
      "recover it for you.",
      "",
      `Created: ${new Date().toISOString().slice(0, 10)}`,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "starlit-pay-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
        <h1 className="mt-4 text-[28px] font-medium text-foreground">Save your recovery code</h1>
        <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
          If you lose your passkeys and forget your PIN, this code is the only way back into your wallet.
          We can't recover it for you, and it won't be shown again.
        </p>
      </div>

      <div
        className="select-all rounded-lg border border-primary/25 bg-primary/5 p-4 text-center font-mono text-[17px] font-semibold tracking-wider text-foreground break-all"
        aria-label="Recovery code"
      >
        {code}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={copy} className="h-12 rounded-lg">
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="secondary" onClick={download} className="h-12 rounded-lg">
          <Download /> Download
        </Button>
      </div>

      <label className="flex items-start gap-3 text-[14px] leading-5 text-foreground">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-primary)]"
        />
        I've saved my recovery code somewhere safe.
      </label>

      <Button
        type="button"
        disabled={!saved}
        onClick={onDone}
        className="h-16 w-full rounded-lg bg-primary text-[16px] font-medium shadow-none"
      >
        {doneLabel}
      </Button>
    </div>
  );
}
