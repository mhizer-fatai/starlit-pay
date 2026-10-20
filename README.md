# Starlit Pay

Starlit Pay is a consumer-grade, privacy-by-default multi-asset wallet on Stellar (Soroban) supporting **XLM, USDC, and EURC**. It is designed around client-side zero-knowledge proofs, a Web2-like email & PIN onboarding UX, and built-in Viewing Key compliance disclosures.

> **⚠️ Status: Testnet preview, not audited.** Zero-knowledge proof generation and on-chain verification are **not implemented yet**: the frontend produces placeholder proofs and the on-chain verifier accepts any well-formed proof. Do not use with real funds. See [Implementation Status](#-implementation-status).

The goal: on-chain, the system looks like a single large pool of assets, so no one can see your balance or whom you are paying. Off-chain, your browser holds your key material, generates proofs, and decrypts your transaction logs.

---

## ⚡ Key Features

1.  **Shielded multi-asset pool (Soroban + Rust)**: Deposits lock public XLM, USDC, or EURC into a contract, creating private note commitments. Spent nullifiers check for double-spends without linking claims to deposits.
2.  **Web2 UX (Email Auth & 6-digit PIN)**: Users onboard using an email address. A 6-digit payment PIN encrypts their derived seed locally using AES-GCM and authenticates them on the database.
3.  **In-Browser ZK Prover (in development)**: Planned Circom + Groth16 (BN254) proofs generated client-side in WebAssembly, binding each spend to its recipient and outputs. Currently a placeholder.
4.  **Auditor Viewing Keys**: Dual-key cryptography splits the wallet into a *Spending Key* and a *Viewing Key*. Users can share their Viewing Key with tax authorities or auditors to decrypt their history read-only without giving up control of their funds.
5.  **Decentralized User Registry**: Matches usernames (aliases) with public encryption keys and identity commitments using a Supabase PostgreSQL routing layer.

---

## 🛠️ Tech Stack & Architecture

*   **Smart Contracts**: Rust (`soroban-sdk` v25+), modelled on the **Nethermind Stellar Private Payments (SPP)** modular architecture:
    *   `pool`: Shielded UTXO note pool with TTL state management.
    *   `verifier`: Groth16 verifier contract (**currently a stub**; real BN254 pairing verification is planned).
    *   `asp`: Association Set Providers (Merkle membership & SMT exclusion trees).
*   **ZK Prover (planned)**: Circom + Groth16 over BN254 (snarkjs, WASM) running in-browser, aligned with Nethermind SPP. The Noir circuit in `circuits/` is an early prototype and not wired into the app.
*   **Frontend**: React + Vite + Vanilla CSS (Glassmorphism design system).
*   **Backend Database Router**: Node.js + Express + Supabase Client (managing user registries, gasless transaction relaying, and note indexing).

---

## 🚀 Setup & Installation

### 1. Database Configuration (Supabase)
1.  Create a free project on [Supabase](https://supabase.com).
2.  Go to the **SQL Editor** tab in your Supabase Dashboard.
3.  Click **New Query**, copy the contents of `backend/schema.sql`, and click **Run**. This will create the required `users` and `payment_links` tables.
4.  Configure Google OAuth (optional) in your Supabase Dashboard under Auth Providers.

### 2. Configure Environment Variables
1.  Create a `.env` file in the `frontend/` folder based on `frontend/.env.example`:
    ```bash
    cp frontend/.env.example frontend/.env
    ```
2.  Create a `.env` file in the `backend/` folder based on `backend/.env.example`:
    ```bash
    cp backend/.env.example backend/.env
    ```
3.  Fill in your Supabase URL and Anon Key in both files.

### 3. Launch Backend Database Router
1.  Navigate to the backend directory:
    ```bash
    cd backend
    npm start
    ```
    *(You should see: `Starlit Pay backend database router listening on http://localhost:3001`)*

### 4. Launch React Frontend
1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Start the Vite dev server:
    ```bash
    npm run dev
    ```
3.  Open `http://localhost:5173` in your browser.

---

## 🔄 Cryptographic Flow Details

```
   [ Alice ]                                   [ Blockchain ]
       |                                             |
       |--- 1. Deposit 100 USDC -------------------->| (Locks 100 USDC)
       |    Commitment: C                            | (Adds C to Merkle Tree)
       |                                             |
       |--- 2. Send 30 USDC to @bob ---------------->| (Bob signs and submits)
       |    ZK Proof: Proof                          | (Checks ZK proof on-chain)
       |    Spent Nullifier: N                       | (Marks N as spent)
       |    Recipient Hash: H                        | (Transfers USDC to Bob)
       |                                             |
   [ Bob ]                                           |
       |                                             |
       |<-- 3. Scans Events & Decrypts note ---------|
       |    (Using Bob's Viewing Key)                |
```

---

## 📋 Implementation Status

| Component | Status |
|---|---|
| Testnet deposits, relayer gas sponsorship, SEP-0007 gateway | ✅ Working |
| Note encryption (NaCl box, x25519-xsalsa20-poly1305) | ✅ Working |
| On-chain Merkle tree & nullifier tracking | ✅ Working (but not enforced by proofs, see below) |
| Client-side ZK proof generation | ❌ Placeholder (`frontend/src/lib/zk.ts` hashes inputs; no prover) |
| On-chain Groth16 verification | ❌ Stub (`contracts/src/verifier.rs` returns `Ok(true)`) |
| ASP compliance proofs | ❌ Not implemented (pool uses a plain admin address blocklist) |
| Independent security audit | ❌ Not audited |

Because proofs are not yet verified, the pool's spend functions do not protect funds cryptographically. As an interim guard, `claim`, `withdraw` and `transfer` must be authorized by the configured Starlit relayer (`set_relayer`), so the relayer is a trusted party until real proof verification ships. This is a testnet-only preview.

## 🔒 Security Model (Target Design)

The properties below describe the intended design once real proof verification ships. They are **not enforced today**.

*   **Anti-Replay Guard**: Spent nullifiers are stored on-chain and a reused nullifier is rejected. Without proof verification, though, nothing ties a nullifier to a real note, so this does not yet prevent double-spends.
*   **Front-Running Prevention (planned)**: The recipient is bound into the proof's public inputs, so a changed destination address would fail verification once the verifier is real.
*   **Dual-Key Separation**: The Spending Key is never transmitted over the network and is decrypted in-memory only when verifying transfers. The Viewing Key is used strictly for read-only history decryption.
