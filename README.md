# Starlit Pay

The private money app for the stablecoin era. Starlit Pay lets people hold,
send and receive stablecoins on Stellar with the simplicity of a modern payment
app, while balances and payments stay private. Your private balance lives in
private payment pools that verify real zero-knowledge proofs, built on
Nethermind's [Stellar Private Payments](https://github.com/NethermindEth/stellar-private-payments)
(SPP). On chain, no one can see whom you pay or how much you hold. You sign in
with a passkey, pay people by username, and never need XLM for fees: Starlit
pays them.

**Live on testnet:** [starlitpay.xyz](https://starlitpay.xyz) · API [api.starlitpay.xyz](https://api.starlitpay.xyz)

> **⚠️ Testnet, not audited. Do not use real funds.**
> The proofs are real (Groth16 over BN254, verified on chain with Stellar's
> Protocol 25 host functions), but the system has not been audited, and the
> testnet circuits use a single-party trusted setup. See [Status](#status).

---

## What you can do

- **Sign in with a passkey.** Google confirms your email once; after that a
  passkey (fingerprint, face or screen lock) signs you in. Your keys are stored
  encrypted in a vault that your passkey, a 6-digit PIN or a one-time recovery
  code can open. Older email + PIN accounts upgrade to a passkey.
- **Hold XLM and USDC privately**, in one private pool per asset.
- **Deposit** from any Stellar wallet: scan a SEP-0007 QR code, connect a wallet,
  or pay the deposit address with your memo.
- **Send privately** to a Starlit username, or withdraw to any Stellar address.
- **Move funds between private and public.** Each account can create a public
  smart wallet (an OpenZeppelin smart account controlled by your passkey,
  verified on chain with secp256r1). Transfer moves funds between it and your
  private balance.
- **Request payments** with a payment link that anyone can pay.
- **Download statements** as PDF or Excel.
- **Get test funds** from the faucet: 10 XLM and 20 USDC, once every 24 hours.

## How a private payment works

```
 [ Alice's browser ]                 [ Starlit backend ]           [ Private pool ]
        |                                    |                            |
        |-- 1. builds a payment to @bob ---->|                            |
        |   (Bob's published keys, checked   |                            |
        |   against his wallet's signature)  |                            |
        |-- 2. proves it on this device      |                            |
        |   (Groth16, ~30 s on a desktop)    |                            |
        |-- 3. asks the relayer to sign ---->| checks: one pool call,     |
        |                                    | no deposit, expires soon   |
        |                                    |--- submits, pays the fee ->| verifies the proof,
        |                                    |                            | spends Alice's notes,
 [ Bob's browser ]                           |                            | adds Bob's note
        |<-- 4. syncs the pool's events, finds and decrypts his note -----|
```

Notes are created and decrypted in the browser; the backend never sees their
amounts or owners. Deposits from other wallets go to Starlit's gateway, which
records each payment once as the user's credit; the user's device then proves
the deposit and the gateway signs it as the depositor, so the user's own
address never appears on chain.

## Repository

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite app. Passkeys, the key vault and all proving run in the browser. |
| `frontend/public/zk/spp/` | Nethermind's SPP browser SDK, built from source by [`.github/workflows/spp-sdk.yml`](.github/workflows/spp-sdk.yml) (checksums in `SHA256SUMS`, Starlit's patches in [`.github/spp-patches/`](.github/spp-patches/)). |
| `backend/` | Node.js + Express API: accounts and passkey sessions, the relayer, the deposit gateway, the pools' history archive, users' private-payment keys, faucet, payment links. |
| `backend/sql/` | Database schema for Supabase, with its [run order](backend/sql/README.md). |

The pool contracts and circuits are SPP's, deployed by Starlit on testnet
(addresses in [`frontend/src/lib/spp/deployment.testnet.json`](frontend/src/lib/spp/deployment.testnet.json)).

### Backend

Each feature is a module under `backend/src/modules/`, split into routes,
service and repository, and mounted in one place (`backend/server.js`). Every
request gets an ID, structured JSON logs, input validation (zod), a rate limit
and one error handler. Payments need a fresh passkey or PIN confirmation, and
users can only read and change their own data.

- **Relayer** (`zk_relayer`): pays the network fees. It signs a browser-built
  transaction only if it is a single `transact` call to Starlit's pools that
  moves no deposit, expires within 10 minutes and needs no other signature;
  withdrawals are screened against the blocklist, failing closed. Each payment
  is signed on a channel account leased to that user (`channels.js`, set with
  `CHANNEL_COUNT`), so many people can pay at once.
- **Gateway** (`gateway`, `zk_gateway`): each incoming payment is recorded once
  and becomes the user's credit; it signs a deposit only for exactly that credit.
- **History** (`zk_history`): archives the pools' events and serves them with
  SPP's bootnode protocol, so new devices can rebuild balances beyond Stellar
  RPC's 7-day retention.
- **Keys** (`zk_keys`): users' public note and encryption keys, signed by their
  own wallet so neither a stolen session nor the server can swap them.

`GET /api/health` reports the database, Stellar RPC, the relayer's balance,
the gateway queue and the history archive's lag. `GET /api/metrics` (Prometheus
format) is enabled by setting `METRICS_TOKEN`.

## Run it locally

You need **Node.js 26** (see `.nvmrc`), a [Supabase](https://supabase.com)
project with Google sign-in enabled, and testnet Stellar accounts for the
relayer, gateway and faucet.

1. **Database.** In the Supabase SQL editor, run the files in `backend/sql/` in
   the [listed order](backend/sql/README.md).
2. **Configuration.** Copy the examples and fill them in:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
   The backend needs the Supabase **service-role** key, `AUTH_SESSION_SECRET`,
   `PIN_PEPPER_KEY`, and the relayer, gateway and faucet keys. For passkeys on
   your machine keep `WEBAUTHN_RP_ID=localhost` and set `WEBAUTHN_ORIGINS` to
   the frontend's address.
3. **Backend:**
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   It answers at `http://localhost:3001`. If your local server shares a
   database with a deployed one, set `BACKGROUND_JOBS=off` so payments are not
   processed twice.
4. **Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`.

## Tests

```bash
cd backend && npm test                                     # API, services and a full server boot
cd frontend && npm run lint && npm run typecheck && npm test
```

GitHub Actions runs both on every push to `main` and `backend`.

## Status

| Part | Status |
|---|---|
| Passkey sign-in, key vault, PIN and recovery code | ✅ Working |
| Client-side ZK proofs (Circom + Groth16 over BN254, SPP) | ✅ Working (in the browser) |
| On-chain proof verification (Protocol 25 BN254 / Poseidon) | ✅ Working |
| Compliance blocklist inside the circuit | ✅ Working (testnet blocklist is empty) |
| Private send, withdraw, deposits, payment links, statements | ✅ Working |
| Public smart wallet (passkey on chain) and transfers | ✅ Working |
| Fee sponsorship | ✅ Working |
| Fast proving on mobile browsers | 🚧 Next milestone |
| Encrypted payment history records | 🚧 Planned (stored unencrypted today) |
| Sharing a viewing key with an auditor | 🚧 Planned |
| Multi-party trusted setup | 🚧 Before mainnet (testnet uses a single-party setup) |
| Security audit | ❌ Not audited |

See [ROADMAP.md](ROADMAP.md).

## Security model

- **Keys stay in the browser.** Your keys never leave your device unencrypted.
  The server stores your key vault only in encrypted form; opening it takes your
  passkey, your PIN (checked by the server, with limited attempts) or your
  recovery code.
- **Only your own notes can be spent.** Every spend proves knowledge of the
  notes' secrets; the pool verifies the proof and rejects reused notes.
- **The relayer is not trusted with funds.** It can only sign transactions it
  has checked, and the proof binds each payment's amount and recipient.
- **Local data is encrypted.** The SDK's note database in the browser is
  encrypted with a key derived from your wallet.
- **What the backend sees:** what is public on Stellar anyway (deposit and
  withdrawal amounts), and each user's own payment history records, which are
  stored unencrypted for now.
