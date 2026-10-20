import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink, Fingerprint, Loader2, RefreshCw, Send, ShieldCheck, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isVaultMode } from "@/lib/auth";
import { friendlyAuthError } from "@/lib/passkeyAccount";
import {
  NeedsWalletPasskeyError,
  addRecoveryKey,
  addWalletPasskey,
  createSmartWallet,
  loadSmartWallet,
  readWalletSigners,
  sendFromSmartWallet,
  smartWalletBalance,
  type SmartWalletInfo,
  type WalletToken,
} from "@/lib/smartWallet";
import { isStellarAddress } from "@/lib/stellar";
import type { Prices } from "@/lib/prices";
import { AssetRow, WalletCardHeader, WalletTotal } from "@/components/WalletCard";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * Public smart wallet (C-address) controlled by the user's passkey. For spending
 * public XLM/USDC; it is funded by withdrawing from the private balance.
 */
export function SmartWalletCard({
  hidden = false,
  prices,
  refreshKey = 0,
  onBalances,
}: {
  hidden?: boolean;
  prices: Prices;
  /** Change to reload the wallet (e.g. after a transfer). */
  refreshKey?: number;
  onBalances?: (balances: Record<WalletToken, number> | null) => void;
}) {
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

  const onBalancesRef = useRef(onBalances);
  onBalancesRef.current = onBalances;

  // null = unknown (not read yet or the read failed)
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadSmartWallet();
      setInfo(next);
      if (next.address) {
        const [XLM, USDC] = await Promise.all([smartWalletBalance(next, "XLM"), smartWalletBalance(next, "USDC")]);
        setBalances({ XLM, USDC });
        onBalancesRef.current?.({ XLM, USDC });
        readWalletSigners(next)
          .then((signers) => setHasRecovery(signers.hasRecoveryKey))
          .catch(() => setHasRecovery(null));
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  }, []);

  useEffect(() => {
    if (isVaultMode()) void refresh();
  }, [refresh, refreshKey]);

  if (!isVaultMode()) return null;

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

  const addRecovery = () =>
    run(async () => {
      setStatus("Confirm with your wallet passkey…");
      await addRecoveryKey();
      setHasRecovery(true);
    });

  const copy = async () => {
    if (!info?.address) return;
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

  const hasWalletPasskey = info?.passkeys.length ? info.passkeys.length > 0 : false;
  const loading = !info || (Boolean(info.address) && !balances);
  const xlm = balances?.XLM ?? 0;
  const usdc = balances?.USDC ?? 0;
  const totalUsd = prices.XLM === null && xlm > 0 ? null : usdc * prices.USDC + xlm * (prices.XLM ?? 0);

  return (
    <section className="dash-card wallet-card" aria-label="Public wallet">
      <WalletCardHeader
        icon={<Fingerprint />}
        tone="public"
        title="Public wallet"
        badge="Passkey"
        actions={
          info?.address ? (
            <button type="button" className="balance-eye" onClick={() => void refresh()} aria-label="Refresh public wallet">
              <RefreshCw />
            </button>
          ) : undefined
        }
      />

      {!info ? (
        <WalletTotal usd={null} hidden={false} loading />
      ) : !info.address ? (
        <div className="wallet-empty">
          <p>
            A public Stellar wallet you control with your passkey (Face ID, fingerprint or phone). Hold and spend public
            XLM and USDC; fees are covered by Starlit.
          </p>
          {hasWalletPasskey && !needsPasskey ? (
            <div className="wallet-actions wallet-actions-stack">
              {info.passkeys.map((p) => (
                <Button key={p.credentialId} type="button" onClick={() => create(p.credentialId)} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Create with {p.deviceName ?? "passkey"}
                </Button>
              ))}
              <Button type="button" variant="secondary" onClick={createWithNewPasskey} disabled={busy}>
                <Smartphone /> Use a new phone passkey
              </Button>
            </div>
          ) : (
            <>
              <p className="wallet-caption">
                Your passkeys on this account can't control an on-chain wallet (Windows Hello uses RSA keys; Stellar needs
                ES256). Create a wallet passkey with your phone (scan the QR code) or a security key.
              </p>
              <div className="wallet-actions">
                <Button type="button" onClick={createWithNewPasskey} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Smartphone />} Create wallet passkey
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <WalletTotal usd={totalUsd} hidden={hidden} loading={loading || prices.status === "loading"} />
          <div className="wallet-address">
            <code title={info.address}>{short(info.address)}</code>
            <button type="button" onClick={copy} aria-label="Copy public wallet address">
              {copied ? <Check /> : <Copy />}
            </button>
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${info.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View on Stellar Expert"
            >
              <ExternalLink />
            </a>
          </div>
          <div className="wallet-assets">
            <AssetRow asset="USDC" amount={usdc} price={prices.USDC} hidden={hidden} loading={loading} />
            <AssetRow asset="XLM" amount={xlm} price={prices.XLM} hidden={hidden} loading={loading} />
          </div>
          <p className="wallet-caption">Visible on Stellar. Fees covered by Starlit.</p>
          {hasRecovery === false && (
            <div className="wallet-warning" role="status">
              <p>
                <b>No recovery key yet.</b> Only your wallet passkey can move these funds. Add your recovery key so your
                recovery code can also recover this wallet.
              </p>
              <Button type="button" variant="secondary" onClick={addRecovery} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Add recovery key
              </Button>
            </div>
          )}
          <div className="wallet-actions">
            <Button type="button" onClick={() => setSendOpen((v) => !v)} disabled={busy}>
              <Send /> Send with passkey
            </Button>
          </div>
          {sendOpen && (
            <form className="wallet-send-form" onSubmit={send} noValidate>
              <div className="wallet-token-toggle" role="radiogroup" aria-label="Asset">
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
                {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Confirm and send
              </Button>
            </form>
          )}
          {lastHash && (
            <p className="wallet-caption">
              Sent.{" "}
              <a href={`https://stellar.expert/explorer/testnet/tx/${lastHash}`} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </p>
          )}
        </>
      )}

      {status && <p className="wallet-caption">{status}</p>}
      {error && (
        <p className="wallet-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
