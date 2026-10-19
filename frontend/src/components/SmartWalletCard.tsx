import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, ExternalLink, Fingerprint, Loader2, Plus, RefreshCw, Send, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isVaultMode } from "@/lib/auth";
import { friendlyAuthError } from "@/lib/passkeyAccount";
import {
  NeedsWalletPasskeyError,
  addWalletPasskey,
  createSmartWallet,
  loadSmartWallet,
  sendFromSmartWallet,
  smartWalletBalance,
  type SmartWalletInfo,
  type WalletToken,
} from "@/lib/smartWallet";
import { isStellarAddress } from "@/lib/stellar";
import { formatGrouped } from "@/lib/wallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * Public smart wallet (C-address) controlled by the user's passkey. For spending
 * public XLM/USDC; it is funded by withdrawing from the private balance.
 */
export function SmartWalletCard({ hidden = false }: { hidden?: boolean }) {
  const navigate = useNavigate();
  const [info, setInfo] = useState<SmartWalletInfo | null>(null);
  const [balances, setBalances] = useState<Record<WalletToken, number> | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsPasskey, setNeedsPasskey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [token, setToken] = useState<WalletToken>("XLM");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [lastHash, setLastHash] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadSmartWallet();
      setInfo(next);
      if (next.address) {
        const [XLM, USDC] = await Promise.all([smartWalletBalance(next, "XLM"), smartWalletBalance(next, "USDC")]);
        setBalances({ XLM, USDC });
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  }, []);

  useEffect(() => {
    if (isVaultMode()) void refresh();
  }, [refresh]);

  if (!isVaultMode() || !info) return null;

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof NeedsWalletPasskeyError) setNeedsPasskey(true);
      setError(err instanceof NeedsWalletPasskeyError ? err.message : friendlyAuthError(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const create = (credentialId: string) =>
    run(async () => {
      await createSmartWallet({ credentialId, onStatus: setStatus });
      setNeedsPasskey(false);
      await refresh();
    });

  const createWithNewPasskey = () =>
    run(async () => {
      setStatus("Create the wallet passkey (scan the QR code with your phone if asked)…");
      const credentialId = await addWalletPasskey("Wallet passkey");
      await createSmartWallet({ credentialId, onStatus: setStatus });
      setNeedsPasskey(false);
      await refresh();
    });

  const copy = async () => {
    if (!info.address) return;
    try {
      await navigator.clipboard.writeText(info.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const to = recipient.trim();
    const value = Number(amount);
    if (!isStellarAddress(to)) return setError("Enter a valid Stellar address (G… or C…).");
    if (!(value > 0)) return setError("Enter an amount greater than 0.");
    if (balances && value > balances[token]) return setError(`Not enough ${token} in your smart wallet.`);
    void run(async () => {
      setStatus("Confirm with your passkey…");
      const hash = await sendFromSmartWallet(token, to, value);
      setLastHash(hash);
      setRecipient("");
      setAmount("");
      setSendOpen(false);
      await refresh();
    });
  };

  const hasWalletPasskey = info.passkeys.length > 0;

  return (
    <section className="dash-card smart-wallet-card" aria-label="Smart wallet">
      <div className="card-title-row">
        <span>Smart Wallet</span>
        {info.address && (
          <button type="button" className="smart-wallet-icon-btn" onClick={() => void refresh()} aria-label="Refresh smart wallet">
            <RefreshCw />
          </button>
        )}
      </div>
      <p className="smart-wallet-sub">
        A public Stellar wallet you control with your passkey (Face ID, fingerprint or phone). Use it to hold and spend public
        XLM and USDC. Fees are covered by Starlit.
      </p>

      {!info.address ? (
        <div className="smart-wallet-actions">
          {hasWalletPasskey && !needsPasskey ? (
            <>
              <p className="smart-wallet-note">Choose the passkey that will control your wallet:</p>
              {info.passkeys.map((p) => (
                <Button key={p.credentialId} type="button" onClick={() => create(p.credentialId)} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Create with {p.deviceName ?? "passkey"}
                </Button>
              ))}
              <Button type="button" variant="outline" onClick={createWithNewPasskey} disabled={busy}>
                <Smartphone /> Use a new phone passkey
              </Button>
            </>
          ) : (
            <>
              <p className="smart-wallet-note">
                Your passkeys on this account can't control an on-chain wallet (Windows Hello uses RSA keys; Stellar needs
                ES256). Create a wallet passkey with your phone (scan the QR code) or a security key.
              </p>
              <Button type="button" onClick={createWithNewPasskey} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Smartphone />} Create wallet passkey
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="smart-wallet-address">
            <code title={info.address}>{short(info.address)}</code>
            <button type="button" className="smart-wallet-icon-btn" onClick={copy} aria-label="Copy smart wallet address">
              {copied ? <Check /> : <Copy />}
            </button>
            <a
              className="smart-wallet-icon-btn"
              href={`https://stellar.expert/explorer/testnet/contract/${info.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View on Stellar Expert"
            >
              <ExternalLink />
            </a>
          </div>
          <div className="smart-wallet-balances">
            {(["XLM", "USDC"] as WalletToken[]).map((t) => (
              <div key={t}>
                <span className="holding-label">{t}</span>
                <strong className="holding-amount">
                  {hidden ? "••••••" : balances ? formatGrouped(balances[t]) : "…"}
                </strong>
              </div>
            ))}
          </div>
          <div className="smart-wallet-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(`/send?mode=external&to=${encodeURIComponent(info.address!)}`)}
            >
              <Plus /> Add funds from private balance
            </Button>
            <Button type="button" onClick={() => setSendOpen((v) => !v)} disabled={busy}>
              <Send /> Send
            </Button>
          </div>
          {sendOpen && (
            <form className="smart-wallet-form" onSubmit={send} noValidate>
              <div className="smart-wallet-tokens" role="radiogroup" aria-label="Asset">
                {(["XLM", "USDC"] as WalletToken[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={token === t}
                    className={token === t ? "active" : ""}
                    onClick={() => setToken(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient address (G… or C…)" />
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount in ${token}`} inputMode="decimal" />
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Send with passkey
              </Button>
            </form>
          )}
          {lastHash && (
            <p className="smart-wallet-note">
              Sent.{" "}
              <a href={`https://stellar.expert/explorer/testnet/tx/${lastHash}`} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </p>
          )}
        </>
      )}

      {status && <p className="smart-wallet-note">{status}</p>}
      {error && (
        <p className="smart-wallet-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
