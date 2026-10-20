import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Fingerprint, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isVaultMode } from "@/lib/auth";
import { isValidPin } from "@/lib/keys";
import { confirmPaymentWithPasskey, confirmPaymentWithPin, friendlyAuthError } from "@/lib/passkeyAccount";
import type { WalletToken } from "@/lib/smartWallet";
import { transferToPrivate, transferToPublic } from "@/lib/transfer";
import { formatGrouped } from "@/lib/wallet";

export type TransferDirection = "to-public" | "to-private";
type Balances = Record<WalletToken, number>;

const LABELS = { private: "Private balance", public: "Public wallet" } as const;

/**
 * Moves XLM or USDC between the private (shielded) balance and the public
 * passkey wallet, in either direction.
 */
export function TransferModal({
  initialDirection,
  privateBalances,
  publicBalances,
  onClose,
  onDone,
}: {
  initialDirection: TransferDirection;
  privateBalances: Balances;
  publicBalances: Balances;
  onClose: () => void;
  onDone: () => void;
}) {
  const [direction, setDirection] = useState<TransferDirection>(initialDirection);
  const [token, setToken] = useState<WalletToken>("XLM");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [pin, setPin] = useState("");
  const [hash, setHash] = useState("");

  const toPublic = direction === "to-public";
  const from = toPublic ? LABELS.private : LABELS.public;
  const to = toPublic ? LABELS.public : LABELS.private;
  const available = (toPublic ? privateBalances : publicBalances)[token];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function run(confirm: () => Promise<void>) {
    const value = Number(amount);
    setError("");
    setBusy(true);
    try {
      let txHash: string;
      if (toPublic) {
        // Spending from the private balance needs a passkey tap (or PIN), like Send.
        setStatus("Confirm with your passkey…");
        try {
          await confirm();
        } catch (err) {
          if (isVaultMode() && !needPin) {
            setNeedPin(true);
            throw new Error(`${friendlyAuthError(err)} You can confirm with your PIN instead.`);
          }
          throw err;
        }
        txHash = await transferToPublic(token, value, setStatus);
      } else {
        // The wallet passkey signs the deposit itself.
        txHash = await transferToPrivate(token, value, setStatus);
      }
      setHash(txHash);
      onDone();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return setError("Enter an amount greater than 0.");
    if (value > available) return setError(`You have ${formatGrouped(available)} ${token} in your ${from.toLowerCase()}.`);
    if (needPin) {
      if (!isValidPin(pin)) return setError("PIN must be exactly 6 digits.");
      return void run(() => confirmPaymentWithPin(pin));
    }
    void run(() => (isVaultMode() ? confirmPaymentWithPasskey() : Promise.resolve()));
  }

  return createPortal(
    <div className="transfer-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="transfer-head">
          <h2 id="transfer-title">Transfer</h2>
          <button type="button" className="transfer-close" onClick={onClose} disabled={busy} aria-label="Close">
            <X />
          </button>
        </div>

        {hash ? (
          <div className="transfer-done">
            <p>
              Moved {formatGrouped(Number(amount))} {token} to your {to.toLowerCase()}.
            </p>
            <a href={`https://stellar.expert/explorer/testnet/tx/${hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="transfer-route">
              <div>
                <small>From</small>
                <b>{from}</b>
              </div>
              <button
                type="button"
                className="transfer-swap"
                onClick={() => {
                  setDirection(toPublic ? "to-private" : "to-public");
                  setError("");
                  setNeedPin(false);
                }}
                disabled={busy}
                aria-label="Switch direction"
                title="Switch direction"
              >
                <ArrowDown />
              </button>
              <div>
                <small>To</small>
                <b>{to}</b>
              </div>
            </div>

            <span className="transfer-label">Token</span>
            <div className="transfer-tokens" role="radiogroup" aria-label="Token">
              {(["XLM", "USDC"] as WalletToken[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={token === t}
                  className={token === t ? "active" : ""}
                  onClick={() => setToken(t)}
                  disabled={busy}
                >
                  {t}
                </button>
              ))}
            </div>

            <label className="transfer-label" htmlFor="transfer-amount">
              Amount
            </label>
            <div className="transfer-amount">
              <Input
                id="transfer-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                disabled={busy}
                autoFocus
              />
              <button type="button" onClick={() => setAmount(String(available))} disabled={busy || available <= 0}>
                Max
              </button>
            </div>
            <small className="transfer-hint">
              Available: {formatGrouped(available)} {token}
            </small>

            {needPin && (
              <>
                <label className="transfer-label" htmlFor="transfer-pin">
                  PIN
                </label>
                <Input
                  id="transfer-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit PIN"
                  disabled={busy}
                />
              </>
            )}

            {status && <p className="transfer-status">{status}</p>}
            {error && (
              <p className="transfer-error" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="transfer-submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
              {busy ? "Working…" : needPin ? "Confirm with PIN" : "Transfer"}
            </Button>
            <small className="transfer-hint">
              {toPublic
                ? "Funds leave the shielded pool and become visible on Stellar in your public wallet."
                : "Funds move from your public wallet into the shielded pool and become private."}
            </small>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
