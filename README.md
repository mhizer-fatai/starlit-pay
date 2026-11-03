# Starlit Pay

Starlit Pay is a privacy wallet on Stellar. Your balance lives in a shielded pool
(a Soroban contract modelled on Nethermind's Stellar Private Payments), so on
chain no one can see how much you hold or whom you pay. You sign in with a
passkey, pay people by username, and never need XLM for fees: a relayer pays
them.

**Live on testnet:** [starlitpay.xyz](https://starlitpay.xyz) · API [api.starlitpay.xyz](https://api.starlitpay.xyz)

> **⚠️ Testnet preview, not audited. Do not use real funds.**
> Zero-knowledge proofs are not implemented yet: the app sends placeholder proofs
> and the on-chain verifier accepts them. Until real proofs ship, the pool cannot
> check that a spend uses the spender's own notes, and the relayer is a trusted
> party. See [Status](#status).

---

## What you can do

- **Sign in with a passkey.** Google confirms your email once; after that a
  passkey (fingerprint, face or screen lock) signs you in. Your keys are stored
  encrypted in a vault that your passkey, a 6-digit PIN or a one-time recovery
  code can open. Older email + PIN accounts upgrade to a passkey.
- **Hold XLM and USDC privately.** Your private balance is a set of encrypted
  notes in the shielded pool, readable only with your viewing key.
- **Deposit** from any Stellar wallet: scan a SEP-0007 QR code, connect a wallet,
  or pay the deposit address with your memo. The gateway credits each payment
  exactly once.
- **Send privately** to a Starlit username, or withdraw to any Stellar address.
- **Move funds between private and public.** Each account can create a public
  smart wallet (an OpenZeppelin smart account controlled by your passkey, verified on
  chain with secp256r1). Transfer moves funds between it and your private balance.
- **Request payments** with a payment link that anyone can pay, with or without
  a Starlit account.
- **Download statements** as PDF or Excel.
- **Get test funds** from the faucet: 10 XLM and 20 USDC, once every 24 hours.

## How a private payment works

```
 [ Alice's browser ]            [ Starlit backend ]             [ Shielded pool ]
        |                               |                               |
        |-- 1. deposit 100 USDC ------> gateway ------------------------>| note C added
        |                               |                               |   to the Merkle tree
        |-- 2. pay @bob 30 USDC         |                               |
        |   builds the proof, spends    |                               |
        |   note C (nullifier N),       |                               |
        |   encrypts 30 for Bob and     |                               |
        |   70 change for herself ----> relayer submits, pays the fee -->| N marked spent,
        |                               |                               |   2 new notes added
 [ Bob's browser ]                      |                               |
        |<-- 3. fetches his notes, decrypts them with his viewing key ---|
```

Notes are encrypted to their recipient, so the backend stores them without being
able to read them, and wallets check whether their notes are spent with the pool
directly. The backend does see what is public on Stellar anyway (deposit and
withdrawal amounts) and, for now, each user's own payment history records,
which are stored unencrypted.

## Repository

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite app. Key derivation, note encryption, proofs (placeholder) and passkeys all run in the browser. |
| `backend/` | Node.js + Express API: accounts and passkey sessions, relayer, deposit gateway, event indexer, notes, faucet, payment links. |
| `backend/sql/` | Database schema for Supabase, with its [run order](backend/sql/README.md). |
| `contracts/` | Soroban contracts in Rust: `pool` (shielded pool), `verifier` (stub), `asp` (compliance screening). |
| `circuits/` | Early Noir prototype of the payment circuit; not wired into the app. |

### Backend

Each feature is a module under `backend/src/modules/`, split into routes,
service and repository, and mounted in one place (`backend/server.js`). Every
request gets an ID, structured JSON logs, input validation (zod), a rate limit
and one error handler. Payments need a fresh passkey or PIN confirmation, and
users can only read and change their own data.

Money paths are built to survive restarts and retries: each deposit is recorded
before it is shielded so it is credited once; relayer transactions take turns on
the shared account; the gateway and indexer keep their position in the database.

`GET /api/health` reports the database, Stellar RPC, relayer balance, gateway
queue and indexer lag. `GET /api/metrics` (Prometheus format) is enabled by
setting `METRICS_TOKEN`.

## Run it locally

You need **Node.js 26** (see `.nvmrc`), a [Supabase](https://supabase.com)
project with Google sign-in enabled, and testnet Stellar accounts for the relayer,
gateway and faucet.

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
   database with a deployed one, set `BACKGROUND_JOBS=off` so deposits are not
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
| Deposits (gateway, SEP-0007, wallet connect), exactly once | ✅ Working |
| Private send, withdraw, payment links, statements | ✅ Working |
| Public smart wallet (passkey on chain) and transfers | ✅ Working |
| Note encryption (NaCl box: x25519-xsalsa20-poly1305) | ✅ Working |
| Merkle tree and nullifier tracking on chain | ✅ Working, but not enforced by proofs |
| Fee sponsorship by the relayer | ✅ Working |
| Client-side ZK proofs (Circom + Groth16 over BN254) | ❌ Placeholder (`frontend/src/lib/zk.ts`) |
| On-chain proof verification | ❌ Stub (`contracts/src/verifier.rs` accepts any proof) |
| Compliance screening contract (ASP) | ⚠️ Written (`contracts/src/asp.rs`), not deployed; withdrawals fail closed against the built-in blocklist |
| Sharing a viewing key with an auditor | ❌ Planned |
| Security audit | ❌ Not audited |

Because proofs are not verified yet, the pool's spend functions accept a call
only from the Starlit relayer (`set_relayer`). The relayer is therefore trusted
until real verification ships; that is the next milestone. See
[ROADMAP.md](ROADMAP.md).

## Security model

Today:

- **Keys stay in the browser.** The spending key never leaves your device
  unencrypted. The server stores your key vault only in encrypted form; opening
  it takes your passkey, your PIN (checked by the server, with limited attempts)
  or your recovery code.
- **Viewing and spending are separate.** The viewing key decrypts your notes and
  history; it cannot move funds.
- **Spent notes can't be reused.** The pool records each nullifier and rejects a
  repeat.

Once real proofs ship:

- **Only your own notes can be spent.** A spend must prove it knows the note's
  secret, with no trusted relayer.
- **The recipient can't be changed in flight.** It is bound into the proof.
