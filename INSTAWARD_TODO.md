# Starlit Pay: Instaward 30-Day Execution Plan & TODO

## 1. Engagement Overview

- **Project Name:** Starlit Pay
- **Organization:** Starlit Organisation
- **Grant Track:** Stellar Instawards (Stellar Community Fund)
- **Ambassador Chapter:** Stellar Nigeria
- **Ambassador Chapter Lead:** David Ogoegbunem
- **Requested Budget:** $5,000 USD
- **Sprint Duration:** 30 Calendar Days (Suggested Start: September 28, 2026)
- **Network Scope:** Stellar Testnet

---

## 2. In-Scope Deliverables Summary

### Deliverable 1: SEP-0007 QR Gateway & Stellar Wallets Kit Shielded Deposit Portal
- Build an ecosystem-integrated deposit gateway supporting SEP-0007 dynamic QR codes (`web+stellar:pay`) and the Stellar Wallets Kit.
- Enable users to scan a QR code with mobile Stellar wallets (LOBSTR, Solar) or connect browser extensions (Freighter, xBull) to deposit and automatically shield public XLM and USDC into private note commitments with sponsored relayer fees.

### Deliverable 2: Production Cloud Infrastructure & Automated Relayer Gas Monitor
- Deploy a hardened, high-availability production environment on an official custom domain with valid SSL.
- Migrate backend services to dedicated hosting to eliminate cold starts and latency delays.
- Implement database connection pooling for high concurrent traffic.
- Build an automated background daemon that monitors the gas-sponsoring relayer balance on Stellar Testnet and triggers real-time low-balance alerts.

### Deliverable 3: Stellar Native Passkey Biometric Authentication (WebAuthn / CAP-0051)
- Integrate Stellar's native Passkey authentication standard (CAP-0051 / `secp256r1`).
- Enable biometric authentication (Face ID, Touch ID, Windows Hello) via WebAuthn.
- Allow users to register their device, log into Starlit Pay seamlessly, and authorize private shielded transfers with a single biometric touch instead of repeatedly typing a 6-digit PIN.

---

## 3. 30-Day Weekly Execution Checklist

### Week 1: Production Infrastructure, Custom Domain & Automated Relayer Gas Monitoring
- [x] Production Backend & Database Hardening:
  - [x] Configure database connection pooling with HTTP persistent keepalive and Supavisor settings for high concurrent load.
  - [x] Secure production CORS policies and strict rate-limiting headers with custom domain support.
  - [x] Expose `/api/health/db` endpoint for connection latency and pool diagnostic verification.
- [x] Automated Relayer Gas Monitoring Daemon:
  - [x] Implement automated background daemon (`backend/src/relayer_monitor.js`) checking relayer XLM reserves continuously.
  - [x] Set threshold alerts (Warn: 50 XLM, Critical: 15 XLM) with structured timestamped logging and webhook dispatch support.
  - [x] Expose `/api/relayer/health`, `/api/relayer/daemon/status`, and `/api/relayer/daemon/check-now` endpoints reporting live balance, history buffer, and telemetry metrics.
- [x] Domain & SSL Setup:
  - [x] Connect custom domain on DNS (Netlify & Render).
  - [x] Enforce SSL and custom domain production deployment (`https://starlitpay.xyz` & `https://api.starlitpay.xyz`).
- [x] Week 1 Deliverable Checkpoint:
  - [x] Live production URL operational with SSL (`https://starlitpay.xyz`).
  - [x] Live production API operational with SSL (`https://api.starlitpay.xyz`).
  - [x] Active background relayer monitoring daemon verified on Stellar Testnet.
  - [x] Database connection pooling active and verified.

### Week 2: SEP-0007 QR Gateway & Stellar Wallets Kit Integration
- [ ] Dynamic SEP-0007 URI & QR Code Generation:
  - [ ] Install and configure lightweight SVG QR code generator in `frontend/`.
  - [ ] Implement SEP-0007 URI generator formatting `web+stellar:pay?destination=...&amount=...&asset_code=...&memo=...`.
  - [ ] Add mobile QR display modal in the Deposit workflow.
- [ ] Stellar Wallets Kit Integration:
  - [ ] Integrate `@creit.tech/stellar-wallets-kit` modal in `frontend/src/components/Balances.jsx`.
  - [ ] Support one-click connection for Freighter, LOBSTR, xBull, and Hana.
  - [ ] Implement client-side transaction signing and submission to the deposit gateway.
- [ ] Automated Deposit Shielding Pipeline:
  - [ ] Connect deposit events from connected wallets to backend gateway `/api/gateway/deposit`.
  - [ ] Automatically mint encrypted shielded note commitments into the user's private balance upon confirmation.
- [ ] Week 2 Deliverable Checkpoint:
  - [ ] Mobile users can scan SEP-0007 QR codes with LOBSTR/Solar to deposit.
  - [ ] Desktop users can connect Freighter to deposit public XLM/USDC into the shielded pool.

### Week 3: Stellar Native Passkey Biometric Authentication (CAP-0051)
- [ ] WebAuthn Device Registration Flow:
  - [ ] Implement client-side WebAuthn credential creation (`navigator.credentials.create`) in `frontend/src/utils/crypto.js`.
  - [ ] Support biometric enrollment (Face ID, Touch ID, Windows Hello).
  - [ ] Store public credential identifiers safely in user profile metadata.
- [ ] Biometric Signature Generation & Challenge Verification:
  - [ ] Implement assertion signing (`navigator.credentials.get`) on transfer and withdrawal authorizations.
  - [ ] Parse and format `secp256r1` signature and client data JSON payloads for Stellar Soroban contracts.
- [ ] Soroban Host Function Integration (CAP-0051):
  - [ ] Implement verification logic utilizing Soroban native `secp256r1` host functions.
  - [ ] Connect biometric auth state with note derivation and transaction dispatch.
  - [ ] Provide seamless fallback to 6-digit PIN for devices without biometric hardware.
- [ ] Week 3 Deliverable Checkpoint:
  - [ ] Users can register their device biometrics and sign in with Face ID / Touch ID.
  - [ ] Private payments can be authorized via biometric tap on supported devices.

### Week 4: End-to-End Hardening, QA Testing & Sprint Evidence Compilation
- [ ] Comprehensive Integration & Stress Testing:
  - [ ] Run full end-to-end user flows: External Wallet Deposit (SEP-0007) -> Biometric Unlock -> Private Transfer -> Withdrawal.
  - [ ] Verify gas sponsorship across multiple consecutive transactions.
  - [ ] Test browser compatibility across Chrome, Safari (iOS), Firefox, and Android browsers.
- [ ] Evidence Gathering & Documentation:
  - [ ] Collect live testnet transaction hashes on Stellar.expert demonstrating:
    - [ ] External wallet deposit into shielded contract.
    - [ ] Sponsored relayer fee transfer execution.
    - [ ] Passkey signature authorization verification.
  - [ ] Capture screenshots of custom domain SSL and sub-second latency benchmarks.
  - [ ] Record a high-quality 2-minute product video walkthrough covering all 3 deliverables.
- [ ] Final Sprint Submission:
  - [ ] Compile final results report for the Ambassador Chapter Lead.
  - [ ] Complete the Instawards sprint review.
  - [ ] Prepare application transition for follow-on SCF Build Award.

---

## 4. Evidence Verification Checklist (For Ambassador Review)

| Deliverable | Planned Evidence | Status |
| :--- | :--- | :--- |
| **Deliverable 1: SEP-0007 & Wallets Kit** | Live web app link with QR deposit flow + Stellar Testnet explorer links (Stellar.expert) showing public-to-shielded contract deposits from external wallets | Planned |
| **Deliverable 2: Production Infrastructure** | Live custom domain URL with valid SSL, sub-second latency proof, and automated relayer daemon monitoring logs on testnet | **Completed** (`https://starlitpay.xyz` & `https://api.starlitpay.xyz`) |
| **Deliverable 3: Passkeys (CAP-0051)** | Demonstrated Face ID / Touch ID wallet login on live app + Soroban transaction verification logs confirming biometric authorization | Planned |
| **Overall Sprint** | 2-minute public product walkthrough video + final technical report | Planned |

---

## 5. Explicit Out-of-Scope Guardrails

- **Stellar Mainnet Deployment:** All testing, contracts, and relayer execution remain strictly on Stellar Testnet.
- **Fiat On/Off-Ramps:** Direct fiat banking, credit cards, or local bank rails are excluded from this 30-day scope.
- **Paid Marketing & User Acquisition:** Focus is 100% on technical engineering, protocol integration, and deployment stability.
