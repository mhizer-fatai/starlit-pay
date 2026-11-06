# Database schema

Run these in the Supabase SQL editor. Every file is safe to re-run. On a new
database, run them in this order:

1. `schema.sql`: users and payment links
2. `schema_notes.sql`: shielded notes
3. `schema_auth.sql`, then `schema_auth_v2.sql`: passkey sign-in and the key vault
4. `schema_settings.sql`: user settings
5. `schema_smart_wallet.sql`: public smart wallets
6. `schema_gateway.sql`: exactly-once deposits and background job positions
7. `schema_faucet.sql`: faucet cooldown
8. `schema_phase3.sql`: one payment per payment link
9. `schema_zk_keys.sql`: users' public keys for private payments (real ZK)
10. `schema_zk_history.sql`: archive of the private pools' events (real ZK)
11. `schema_zk_gateway.sql`: gateway credits for the private pools (real ZK)
12. `schema_lockdown.sql`: locks every table to the backend's service role (run
   it after the backend is deployed with `SUPABASE_SERVICE_ROLE_KEY`)

The gateway also needs a starting position (`daemon_state` row `gateway`), so
it doesn't replay old deposits. That seed is specific to the gateway account's
history, so it isn't kept here.

After creating `zk_events`, load the saved copy of the pools' early events
(Stellar RPC keeps only ~7 days): `node scripts/zk_history_import.js <events.json>`.
