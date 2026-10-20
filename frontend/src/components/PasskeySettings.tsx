import { useCallback, useEffect, useState } from "react";
import { Check, Fingerprint, KeyRound, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { RecoveryCodePanel } from "@/components/RecoveryCodePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getVaultSecrets, isVaultMode } from "@/lib/auth";
import { isValidPin } from "@/lib/keys";
import { friendlyAuthError, guessDeviceName, passkeysSupported } from "@/lib/passkeyAccount";
import type { PublicPasskey } from "@/lib/vault/api";
import { authApi, getEmailProof, passkeyFlows } from "@/lib/vault/client";
import { loadSmartWallet, readWalletSigners } from "@/lib/smartWallet";

/** Credential ids of the passkeys that control the user's public wallet (read on-chain). */
async function walletPasskeyIds(): Promise<Set<string>> {
  try {
    const info = await loadSmartWallet();
    if (!info.address) return new Set();
    return new Set((await readWalletSigners(info)).passkeyCredentialIds);
  } catch {
    return new Set();
  }
}

const PIN_INPUT_STYLE = { textAlign: "center", letterSpacing: "6px" } as const;

function formatDate(value: string | null) {
  if (!value) return "never";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Passkeys, PIN and recovery code for passkey accounts (Settings → Security). */
export function PasskeySettings() {
  const vaultMode = isVaultMode();
  const [passkeys, setPasskeys] = useState<PublicPasskey[]>([]);
  const [unlockIds, setUnlockIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(vaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const [walletIds, setWalletIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    void walletPasskeyIds().then(setWalletIds);
    try {
      const [list, status] = await Promise.all([authApi.listPasskeys(), authApi.getVaultStatus()]);
      setPasskeys(list.passkeys);
      setUnlockIds(new Set(status.passkeyWraps));
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (vaultMode) void load();
  }, [vaultMode, load]);

  /** Sensitive changes need a sign-in in the last few minutes; ask for the passkey if not. */
  async function ensureFresh() {
    const session = await authApi.getSession();
    if (!session.fresh) await passkeyFlows.stepUp();
  }

  function openSecrets() {
    const secrets = getVaultSecrets();
    if (!secrets) throw new Error("Your wallet is locked. Sign in again to make this change.");
    return secrets;
  }

  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  const addPasskey = () =>
    run(async () => {
      const secrets = openSecrets();
      // With no passkey yet there is nothing to confirm with; the Google proof is used instead.
      if (passkeys.length > 0) await ensureFresh();
      const { canUnlock } = await passkeyFlows.addPasskey(secrets, guessDeviceName(), { emailProof: await getEmailProof() });
      setNotice(
        canUnlock
          ? "Passkey added. It can unlock your wallet on this device."
          : "Passkey added for sign-in. This device can't unlock the wallet with it, so you'll also use your PIN here."
      );
      await load();
    });

  const startRename = (passkey: PublicPasskey) => {
    setEditingId(passkey.id);
    setEditName(passkey.deviceName ?? "");
  };

  const saveRename = (event: React.FormEvent) => {
    event.preventDefault();
    const id = editingId;
    const name = editName.trim();
    if (!id || !name) return;
    void run(async () => {
      await authApi.renamePasskey(id, name);
      setEditingId(null);
      await load();
    });
  };

  const removePasskey = (passkey: PublicPasskey) =>
    run(async () => {
      const name = passkey.deviceName ?? "Passkey";
      if (!window.confirm(`Remove the passkey "${name}"? Devices signed in with it (possibly this one) will be signed out.`)) return;
      await ensureFresh();
      await authApi.removePasskey(passkey.id);
      setNotice("Passkey removed.");
      await load();
    });

  const changePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPin(newPin) || newPin !== newPinConfirm) {
      setError(newPin !== newPinConfirm ? "PINs do not match." : "PIN must be exactly 6 digits.");
      return;
    }
    void run(async () => {
      const secrets = openSecrets();
      await ensureFresh();
      await passkeyFlows.setPin(secrets, newPin);
      setNewPin("");
      setNewPinConfirm("");
      setPinFormOpen(false);
      setNotice("PIN changed.");
    });
  };

  const newRecoveryCode = () =>
    run(async () => {
      if (!window.confirm("Create a new recovery code? Your old code will stop working.")) return;
      const secrets = openSecrets();
      await ensureFresh();
      setRecoveryCode(await passkeyFlows.setRecoveryCode(secrets));
    });

  if (!vaultMode) {
    return (
      <div className="settings-list-row">
        <div className="settings-list-copy">
          <b>
            <Fingerprint /> Passkeys
          </b>
          <small>Passkey sign-in for existing accounts is coming in the next update.</small>
        </div>
      </div>
    );
  }

  if (recoveryCode) {
    return (
      <div className="rounded-lg border border-border p-5">
        <RecoveryCodePanel code={recoveryCode} onDone={() => setRecoveryCode("")} doneLabel="Done" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="settings-list">
        {loading && (
          <div className="settings-list-row">
            <div className="settings-list-copy">
              <small>Loading passkeys…</small>
            </div>
          </div>
        )}
        {passkeys.map((p) => (
          <div key={p.id} className="settings-list-row">
            <div className="settings-list-copy">
              {editingId === p.id ? (
                <form className="passkey-rename" onSubmit={saveRename}>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={64}
                    autoFocus
                    aria-label="Passkey name"
                    placeholder="e.g. My phone"
                  />
                  <Button type="submit" variant="ghost" size="icon" disabled={busy || !editName.trim()} aria-label="Save name">
                    <Check />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setEditingId(null)} aria-label="Cancel">
                    <X />
                  </Button>
                </form>
              ) : (
                <b>
                  <Fingerprint /> {p.deviceName ?? "Passkey"}
                  {walletIds.has(p.credentialId) && <span className="passkey-badge">Controls your public wallet</span>}
                </b>
              )}
              <small>
                {p.pending
                  ? "Waiting period — active soon"
                  : unlockIds.has(p.id)
                    ? "Signs in and unlocks your wallet"
                    : "Signs in only (PIN unlocks the wallet)"}
                {" · "}Added {formatDate(p.createdAt)} · Last used {formatDate(p.lastUsedAt)}
              </small>
            </div>
            {editingId !== p.id && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => startRename(p)}
                disabled={busy}
                aria-label={`Rename passkey ${p.deviceName ?? ""}`}
              >
                <Pencil />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removePasskey(p)}
              disabled={busy}
              aria-label={`Remove passkey ${p.deviceName ?? ""}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      <div className="settings-grid">
        <Button type="button" variant="secondary" className="settings-action-btn" onClick={addPasskey} disabled={busy || !passkeysSupported()}>
          <Plus /> Add a passkey for this device
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="settings-action-btn"
          onClick={() => {
            setError("");
            setPinFormOpen((open) => !open);
          }}
          disabled={busy}
        >
          <KeyRound /> Change PIN
        </Button>
        <Button type="button" variant="secondary" className="settings-action-btn" onClick={newRecoveryCode} disabled={busy}>
          <RefreshCw /> New recovery code
        </Button>
      </div>

      {pinFormOpen && (
        <form onSubmit={changePin} className="space-y-3 rounded-lg border border-border p-4">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            placeholder="New 6-digit PIN"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy}
            style={PIN_INPUT_STYLE}
          />
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            placeholder="Confirm new PIN"
            value={newPinConfirm}
            onChange={(e) => setNewPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy}
            style={PIN_INPUT_STYLE}
          />
          <Button type="submit" disabled={busy} className="w-full">
            Save new PIN
          </Button>
        </form>
      )}

      {busy && <p className="text-sm text-muted-foreground" role="status">Working… confirm with your passkey if asked.</p>}
      {notice && !error && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
    </div>
  );
}
