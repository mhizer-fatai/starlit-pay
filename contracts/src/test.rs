#![cfg(test)]

use super::pool::{ShieldedPool, ShieldedPoolClient, ContractError};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Bytes, BytesN, Env, IntoVal, symbol_short
};

// Simple contract to deploy a mock token for testing
fn create_token_contract<'a>(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract(admin.clone())
}

#[test]
fn test_pool_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // Create accounts
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Create Mock Token (e.g. USDC)
    let token_address = create_token_contract(&env, &admin);
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

    // Mint some tokens to depositor
    token_admin.mint(&depositor, &5000);

    // Deploy ShieldedPool
    let pool_id = env.register(ShieldedPool, ());
    let pool_client = ShieldedPoolClient::new(&env, &pool_id);

    // Initialize Pool
    pool_client.initialize(&admin);

    // Assert re-initialization fails
    let reinit_result = pool_client.try_initialize(&admin);
    assert_eq!(reinit_result.err(), Some(Ok(ContractError::AlreadyInitialized)));

    // Generate test data
    let commitment1 = BytesN::from_array(&env, &[1u8; 32]);
    let encrypted_note1 = Bytes::from_array(&env, &[9u8; 64]);
    let amount = 1000i128;

    // Verify depositor balance
    let depositor_token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(depositor_token_client.balance(&depositor), 5000);

    // 1. Perform Deposit
    let root = pool_client.deposit(&depositor, &token_address, &amount, &commitment1, &encrypted_note1);

    // Verify events were published
    let events = env.events().all();
    assert!(events.events().len() > 0);

    // Verify balance transferred to pool contract
    assert_eq!(depositor_token_client.balance(&depositor), 4000);
    assert_eq!(depositor_token_client.balance(&pool_id), 1000);

    // Verify Merkle Root is registered as valid
    assert!(pool_client.is_root_valid(&root));

    // 2. Perform Claim
    let proof = Bytes::from_array(&env, &[123u8; 100]); // Non-empty simulated proof
    let nullifier = BytesN::from_array(&env, &[2u8; 32]);

    assert!(!pool_client.is_nullifier_spent(&nullifier));

    pool_client.claim(&proof, &nullifier, &recipient, &token_address, &amount, &root);

    // Verify funds transferred to recipient
    assert_eq!(depositor_token_client.balance(&recipient), 1000);
    assert_eq!(depositor_token_client.balance(&pool_id), 0);

    // Verify nullifier marked as spent
    assert!(pool_client.is_nullifier_spent(&nullifier));

    // 3. Double Spend Check (should fail)
    let double_spend_result = pool_client.try_claim(&proof, &nullifier, &recipient, &token_address, &amount, &root);
    assert_eq!(double_spend_result.err(), Some(Ok(ContractError::AlreadySpent)));

    // 4. Invalid Merkle Root Check (should fail)
    let bad_root = BytesN::from_array(&env, &[99u8; 32]);
    let unused_nullifier = BytesN::from_array(&env, &[3u8; 32]);
    let bad_root_result = pool_client.try_claim(&proof, &unused_nullifier, &recipient, &token_address, &amount, &bad_root);
    assert_eq!(bad_root_result.err(), Some(Ok(ContractError::InvalidRoot)));

    // 5. Verification Failed Check (empty proof should fail)
    let empty_proof = Bytes::new(&env);
    let verify_fail_result = pool_client.try_claim(&empty_proof, &unused_nullifier, &recipient, &token_address, &amount, &root);
    assert_eq!(verify_fail_result.err(), Some(Ok(ContractError::VerificationFailed)));
}
