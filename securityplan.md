# Starlit Pay: Comprehensive Security Protocol & Architecture Plan

## 1. Executive Summary

This document outlines the end-to-end security protocol, cryptographic protections, and architecture roadmap for **Starlit Pay**. Starlit Pay is a non-custodial, confidential payment application built on Stellar and Soroban. It leverages zero-knowledge proofs (Nethermind Shielded Pool Protocol / Groth16 over BLS12-381 via CAP-0059), automated relayer gas sponsorship, and hardware-backed biometric passkeys (CAP-0051 / secp256r1).

This document serves as the persistent technical specification across development sprints.

---

## 2. Current Security Baseline (Active in Code)

The following security controls are active and operational on the `backend` branch:

### 2.1 Client-Side Cryptographic Isolation
- **Zero Plaintext Transmission:** Transaction amounts, recipients, nullifiers, and secrets are encrypted client-side before touching the network.
- **Local Key Derivation:** Private spending keys and viewing keys are derived deterministically using `sha256(email + pin)`.
- **Authenticated Encryption:** Notes are encrypted with TweetNaCl box (`x25519-xsalsa20-poly1305`) authenticated public-key cryptography.
- **Session Hygiene:** Logout completely purges local storage, clearing JWT tokens, Supabase authentication tokens (`sb-*`), and all `starlit_*` keys.

### 2.2 Relayer Gas Sponsorship & Health Monitoring
- **Automated Gas Monitor Daemon:** Continuous background worker (`backend/src/relayer_monitor.js`) querying Horizon testnet at fixed intervals (default: 60s).
- **Dual-Threshold Alerting:**
  - `WARNING`: Balance < 50 XLM (logs warning, prepares top-up notification).
  - `CRITICAL`: Balance < 15 XLM (logs critical error, triggers webhook alerts).
- **Resilient Error Recovery:** Transient Horizon/RPC network drops are captured gracefully without terminating the Express server or daemon loop.
- **Audit History Ring Buffer:** In-memory circular buffer retains the last 30 balance checks and response latencies for audit observability (`GET /api/relayer/daemon/status`).

### 2.3 Backend API Hardening & Connection Pooling
- **Database Connection Pooling:** HTTP persistent keep-alive configured on Supabase PostgREST clients to eliminate TCP socket exhaustion under high concurrency.
- **Supavisor Integration Options:** Dedicated configuration for Supabase PostgreSQL transaction pooling (`port 6543`, `maxSockets: 50`, `timeoutMs: 30000`).
- **Strict CORS & Custom Domain Whitelisting:** Restricted origin checking supporting dynamic custom domains (`CUSTOM_DOMAIN`).
- **Security Headers:** Enforced `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `X-XSS-Protection`.
- **Compliance Filtering (ASP):** Address screening module (`backend/src/asp_service.js`) checks recipient addresses against blacklists before dispatching relayer transactions.

---

## 3. Planned Security Protocols (Roadmap & Implementation Specs)

### Phase 1: CAP-0051 / WebAuthn Biometric Passkey Authentication (Instaward Week 3)

#### Objective
Replace PIN-based encryption and session unlocking with hardware-bound, tamper-proof device biometrics (Face ID, Touch ID, Windows Hello) using native Soroban `secp256r1` host functions under CAP-0051.

#### Technical Architecture
1. **Device Registration Flow (`navigator.credentials.create`):**
   - User initiates biometric enrollment on their device.
   - Client requests challenge from backend: `crypto.getRandomValues(32)`.
   - Browser prompts biometric verification and creates a `secp256r1` (P-256) keypair inside the device Secure Enclave / TPM.
   - Public key and credential ID are registered on the user profile; private key never leaves hardware.
2. **Transfer / Withdrawal Authorization Flow (`navigator.credentials.get`):**
   - Client generates the transaction payload (transfer commitment or withdrawal address + amount).
   - Payload hash is passed as the WebAuthn challenge.
   - User touches biometric sensor (Face ID / fingerprint).
   - Client receives the authenticator response: `authenticatorData`, `clientDataJSON`, and ASN.1 DER signature $(r, s)$.
3. **On-Chain Soroban Verification (CAP-0051):**
   - Signature $(r, s)$ is unpacked and passed alongside client data hash to Soroban contract verifier.
   - Contract invokes native host function `crypto::secp256r1_verify` to validate authenticator signature without custom EVM-style emulation.
4. **Fallback Mechanism:**
   - For devices or legacy browsers lacking WebAuthn support, the 6-digit PIN cryptographic derivation remains fully available as a secure fallback.

---

### Phase 2: Relayer, Front-Running & Replay Defenses

#### 2.1 Front-Running Mitigation
- **Commitment Binding:**
  - For public withdrawals, the withdrawal transaction binds the recipient address into the public inputs of the Groth16 proof:
    $$\text{Public Inputs} = [\text{Merkle Root}, \text{Nullifier}_1, \text{Nullifier}_2, \text{Recipient Address}, \text{Amount}, \text{Token Address}]$$
  - Any front-running relayer or MEV searcher attempting to substitute the recipient address invalidates the Groth16 proof on-chain.
- **Relayer Submission Window:**
  - Transactions use Stellar's ledger time bounds (`setTimeout(180)`) to enforce maximum transaction validity windows.

#### 2.2 Nullifier Replay Protection
- On-chain contracts maintain a persistent ledger set of spent nullifiers.
- Any attempt to reuse a note nullifier immediately aborts transaction execution at the Soroban host level before token transfer occurs.

#### 2.3 Cryptographic Key Segregation
- **Three-Tier Key Isolation:**
  1. `RELAYER_SECRET_KEY`: Exclusively finances gas fees for zero-knowledge transfer and withdrawal claims. Possesses no token withdrawal permissions.
  2. `GATEWAY_SECRET_KEY`: Exclusively coordinates automated public deposit ingest and mints shielded note commitments.
  3. `ADMIN_SECRET_KEY`: Strictly reserved for administrative registry updates and circuit breakers.

---

### Phase 3: Smart Contract Hardening & Soroban Verification

#### 3.1 Nethermind SPP Groth16 Verifier Safety
- **Standard:** Nethermind Shielded Pool Protocol over BLS12-381 (CAP-0059 native host functions).
- **Subgroup Checks:** Verify that proof points $A \in G_1$, $B \in G_2$, and $C \in G_1$ lie strictly on the curve and belong to the correct prime-order subgroups to prevent small subgroup attacks.
- **Pairing Check Equality:**
  $$e(A, B) \stackrel{?}{=} e(\alpha, \beta) \cdot e(x \cdot \gamma, \delta) \cdot e(C, \delta)$$
  Evaluated natively using Protocol 22+ BLS12-381 pairing operations.

#### 3.2 State TTL & Storage Management
- Soroban persistent entries (nullifiers, Merkle roots) require explicit TTL management.
- Implement automated `extend_ttl` operations in the relayer workflow to guarantee that contract state and nullifier sets are never evicted from the ledger.

#### 3.3 SAC (Stellar Asset Contract) Interoperability
- All token interactions utilize the official SEP-41 token interface.
- Contract balances and deposits verify exact token transfer amounts before appending leaves to the Merkle tree.

---

### Phase 4: Production Infrastructure Security (Week 1 Deployment)

#### 4.1 Custom Domain & TLS
- Dedicated production domain with enforced HSTS (`max-age=31536000; includeSubDomains; preload`).
- Automated SSL/TLS certificates via Cloudflare / Let's Encrypt with TLS 1.3 minimum.

#### 4.2 Rate Limiting & Denial of Service Protection
- API Gateway rate limiting:
  - Global endpoints: Max 200 req / 15 min per IP.
  - Relayer submit endpoints: Max 20 submissions / 15 min per IP.
  - Faucet endpoints: Max 10 requests / 15 min per IP.
  - Faucet claim cooldown: 4 hours strictly enforced per account and per Stellar address.

---

## 4. Security Verification & Audit Checklist

- [ ] **Cryptographic Verification:** Confirm Groth16 proof generation matches BLS12-381 parameters without Noir/BN254 discrepancies.
- [ ] **Passkey Enrollment:** Verify WebAuthn registration on iOS (Face ID), Android (Fingerprint), and Windows (Hello).
- [ ] **Replay Protection:** Verify that submitting duplicate nullifiers on Testnet returns transaction failure.
- [ ] **Front-Running Test:** Verify that tampering with recipient address causes contract simulation failure.
- [ ] **Relayer Low-Gas Alert:** Verify webhook dispatch when relayer balance simulated below 50 XLM.
- [ ] **TTL Persistence:** Verify contract instance and persistent storage entries have TTL exceeding 100,000 ledgers.
- [ ] **Session Teardown:** Confirm zero credential leakage in `localStorage` upon logout.
