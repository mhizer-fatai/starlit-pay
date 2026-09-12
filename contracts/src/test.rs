#![cfg(test)]

use super::pool::{ShieldedPool, ShieldedPoolClient, ContractError};
use super::asp::{AssociationSetProvider, AssociationSetProviderClient};
use super::verifier::Groth16Verifier;
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Bytes, BytesN, Env
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
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

    // Mint some tokens to depositor
    token_admin.mint(&depositor, &5000);

    // Deploy Groth16Verifier
    let verifier_id = env.register(Groth16Verifier, ());

    // Deploy ShieldedPool
    let pool_id = env.register(ShieldedPool, ());
    let pool_client = ShieldedPoolClient::new(&env, &pool_id);

    // Initialize Pool with verifier contract
    pool_client.initialize(&admin, &verifier_id);

    // Assert re-initialization fails
    let reinit_result = pool_client.try_initialize(&admin, &verifier_id);
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

#[test]
fn test_asp_compliance_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let sanctioned_user = Address::generate(&env);
    let clean_user = Address::generate(&env);

    let token_address = create_token_contract(&env, &admin);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    token_admin.mint(&depositor, &10000);

    // 1. Deploy Verifier and Pool
    let verifier_id = env.register(Groth16Verifier, ());
    let pool_id = env.register(ShieldedPool, ());
    let pool_client = ShieldedPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &verifier_id);

    // 2. Deploy AssociationSetProvider (ASP)
    let asp_id = env.register(AssociationSetProvider, ());
    let asp_client = AssociationSetProviderClient::new(&env, &asp_id);
    let initial_exclusion_root = BytesN::from_array(&env, &[10u8; 32]);
    asp_client.initialize_asp(&admin, &initial_exclusion_root);

    // Connect ASP to Pool
    pool_client.set_asp(&asp_id);

    // 3. Blacklist the sanctioned_user in ASP
    assert!(!asp_client.is_address_blocked(&sanctioned_user));
    asp_client.block_address(&sanctioned_user);
    assert!(asp_client.is_address_blocked(&sanctioned_user));

    // 4. Deposit funds into pool
    let commitment = BytesN::from_array(&env, &[5u8; 32]);
    let encrypted_note = Bytes::from_array(&env, &[7u8; 64]);
    let root = pool_client.deposit(&depositor, &token_address, &2000i128, &commitment, &encrypted_note);

    // 5. Sanctioned user attempts to withdraw -> Must fail with AddressBlocked
    let proof = Bytes::from_array(&env, &[123u8; 100]);
    let nullifier = BytesN::from_array(&env, &[88u8; 32]);
    let blocked_claim = pool_client.try_claim(
        &proof,
        &nullifier,
        &sanctioned_user,
        &token_address,
        &1000i128,
        &root
    );
    assert_eq!(blocked_claim.err(), Some(Ok(ContractError::AddressBlocked)));

    // 6. Clean user withdraws -> Succeeds!
    pool_client.claim(
        &proof,
        &nullifier,
        &clean_user,
        &token_address,
        &1000i128,
        &root
    );

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&clean_user), 1000);

    // 7. Test unblocking functionality
    asp_client.unblock_address(&sanctioned_user);
    assert!(!asp_client.is_address_blocked(&sanctioned_user));

    // 8. Test exclusion root rotation
    let new_exclusion_root = BytesN::from_array(&env, &[20u8; 32]);
    asp_client.update_exclusion_root(&new_exclusion_root);
    assert_eq!(asp_client.get_exclusion_root(), new_exclusion_root);
    assert!(asp_client.is_asp_root_valid(&initial_exclusion_root));
    assert!(asp_client.is_asp_root_valid(&new_exclusion_root));
}
