# Starlit Pay

Starlit Pay is a consumer-grade, privacy-by-default multi-asset wallet protocol on Stellar (Soroban) supporting **XLM, USDC, and EURC**. It features client-side ZK-SNARK proof generation, a Web2-like email & PIN onboarding UX, and built-in Viewing Key compliance disclosures.

On-chain, it looks like a single large pool of assets. No one can see your balance or whom you are paying. Off-chain, your browser holds your key material, compiles circuits in WebAssembly, generates proofs, and decrypts your transaction logs.

---

## ⚡ Key Features

1.  **Shielded multi-asset pool (Soroban + Rust)**: Deposits lock public XLM, USDC, or EURC into a contract, creating private note commitments. Spent nullifiers check for double-spends without linking claims to deposits.
2.  **Web2 UX (Email Auth & 6-digit PIN)**: Users onboard using an email address. A 6-digit payment PIN encrypts their derived seed locally using AES-GCM and authenticates them on the database.
3.  **In-Browser ZK Prover**: ZK-SNARK proofs are compiled client-side in WebAssembly. The proofs are front-running resistant, binding claims directly to the recipient's address.
4.  **Auditor Viewing Keys**: Dual-key cryptography splits the wallet into a *Spending Key* and a *Viewing Key*. Users can share their Viewing Key with tax authorities or auditors to decrypt their history read-only without giving up control of their funds.
5.  **Decentralized User Registry**: Matches usernames (aliases) with public encryption keys and identity commitments using a Supabase PostgreSQL routing layer.

---

## 🛠️ Tech Stack & Architecture

*   **Smart Contracts**: Rust (`soroban-sdk` v25.0.1) utilizing native BN254 and SHA256 host functions.
*   **ZK Prover**: Noir Lang (UltraHonk on BN254) running in browser WebAssembly.
*   **Frontend**: React + Vite + Vanilla CSS (Glassmorphism design system).
*   **Backend Database Router**: Node.js + Express + Supabase Client (managing user registries and profile lookups).

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

## 🔒 Security Audits & Assumptions

*   **Anti-Replay Guard**: Spent nullifiers are permanently stored on-chain. If the same nullifier is submitted twice, the contract reverts immediately.
*   **Front-Running Prevention**: The public input `recipient_address_hash` binds the ZK proof to the specific withdrawal recipient. If a miner or front-running bot intercepts the transaction and changes the destination address, the proof verification fails.
*   **Dual-Key Separation**: The Spending Key is never transmitted over the network and is decrypted in-memory only when verifying transfers. The Viewing Key is used strictly for read-only history decryption.
