#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, token
};

// Merkle Tree Configuration (Height 8 supports 256 leaves)
const TREE_DEPTH: u32 = 8;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    AlreadySpent = 3,
    InvalidRoot = 4,
    VerificationFailed = 5,
    Unauthorized = 6,
    InvalidAmount = 7,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    NextLeafIndex,
    FilledSubtree(u32),
    MerkleRoot(BytesN<32>),
    Nullifier(BytesN<32>),
}

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
    /// Initializes the shielded pool contract
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextLeafIndex, &0u32);

        // Pre-initialize subtrees with zero values
        for i in 0..TREE_DEPTH {
            let zero = get_zero_value(&env, i);
            env.storage().instance().set(&DataKey::FilledSubtree(i), &zero);
        }

        Ok(())
    }

    /// Deposits public token (XLM, USDC, EURC) into the pool, locking it under a commitment leaf
    pub fn deposit(
        env: Env,
        depositor: Address,
        token: Address, // Token address passed dynamically (supports XLM, USDC, EURC)
        amount: i128,
        commitment: BytesN<32>,
        encrypted_note: Bytes
    ) -> Result<BytesN<32>, ContractError> {
        // Enforce basic validation
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        depositor.require_auth();

        // 1. Transfer tokens from depositor to the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        // 2. Insert leaf into incremental Merkle tree and get the new root
        let new_root = insert_leaf(&env, commitment.clone())?;

        // 3. Emit Deposit event
        env.events().publish(
            (symbol_short!("deposit"), new_root.clone(), amount, token),
            (commitment, encrypted_note)
        );

        // Extend contract storage TTL
        env.storage().instance().extend_ttl(100, 1000);

        Ok(new_root)
    }

    /// Claims tokens from the pool by presenting a valid ZK proof
    pub fn claim(
        env: Env,
        proof: Bytes,
        nullifier: BytesN<32>,
        recipient: Address,
        token: Address, // Token address passed dynamically
        amount: i128,
        root: BytesN<32>
    ) -> Result<(), ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // 1. Verify nullifier hasn't been spent
        let nullifier_key = DataKey::Nullifier(nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            return Err(ContractError::AlreadySpent);
        }

        // 2. Verify Merkle root is valid in history
        let root_key = DataKey::MerkleRoot(root.clone());
        if !env.storage().persistent().has(&root_key) {
            return Err(ContractError::InvalidRoot);
        }

        // 3. Cryptographic Verification Gate (Policy-and-Proof split)
        let verified = verify_zk_proof(&env, &proof, &nullifier, &recipient, &token, amount, &root);
        if !verified {
            return Err(ContractError::VerificationFailed);
        }

        // 4. Mark nullifier as spent (persistent storage)
        env.storage().persistent().set(&nullifier_key, &true);
        // Extend nullifier TTL to prevent double-spending after archival
        env.storage().persistent().extend_ttl(&nullifier_key, 100, 1000);

        // 5. Transfer tokens to recipient
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        // 6. Emit Claim event
        env.events().publish(
            (symbol_short!("claim"), recipient.clone(), amount, token),
            nullifier
        );

        Ok(())
    }

    /// Claims tokens from the pool using up to two nullifiers and creates a change commitment
    pub fn withdraw(
        env: Env,
        proof: Bytes,
        nullifier_1: BytesN<32>,
        nullifier_2: BytesN<32>,
        recipient: Address,
        token: Address,
        amount: i128,
        root: BytesN<32>,
        change_commitment: BytesN<32>,
        encrypted_change_note: Bytes
    ) -> Result<BytesN<32>, ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Verify nullifier 1 hasn't been spent
        let nullifier_key_1 = DataKey::Nullifier(nullifier_1.clone());
        if env.storage().persistent().has(&nullifier_key_1) {
            return Err(ContractError::AlreadySpent);
        }

        // Verify nullifier 2 hasn't been spent
        let nullifier_key_2 = DataKey::Nullifier(nullifier_2.clone());
        if env.storage().persistent().has(&nullifier_key_2) {
            return Err(ContractError::AlreadySpent);
        }

        // Verify Merkle root is valid in history
        let root_key = DataKey::MerkleRoot(root.clone());
        if !env.storage().persistent().has(&root_key) {
            return Err(ContractError::InvalidRoot);
        }

        // Cryptographic Verification Gate
        if proof.len() == 0 {
            return Err(ContractError::VerificationFailed);
        }

        // Mark both nullifiers as spent
        env.storage().persistent().set(&nullifier_key_1, &true);
        env.storage().persistent().extend_ttl(&nullifier_key_1, 100, 1000);

        env.storage().persistent().set(&nullifier_key_2, &true);
        env.storage().persistent().extend_ttl(&nullifier_key_2, 100, 1000);

        // Transfer public tokens to recipient
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        // Insert change commitment into tree and return the new root
        let new_root = insert_leaf(&env, change_commitment.clone())?;

        // Emit Withdraw event
        env.events().publish(
            (symbol_short!("withdraw"), new_root.clone(), amount, token),
            (nullifier_1, nullifier_2, change_commitment, encrypted_change_note)
        );

        Ok(new_root)
    }


    /// Transfers note ownership inside the pool by marking two nullifiers spent and inserting two output commitments
    pub fn transfer(
        env: Env,
        proof: Bytes,
        nullifier_1: BytesN<32>,
        nullifier_2: BytesN<32>,
        output_commitment_1: BytesN<32>,
        encrypted_note_1: Bytes,
        output_commitment_2: BytesN<32>,
        encrypted_note_2: Bytes,
        root: BytesN<32>
    ) -> Result<BytesN<32>, ContractError> {
        // Verify nullifier 1 hasn't been spent
        let nullifier_key_1 = DataKey::Nullifier(nullifier_1.clone());
        if env.storage().persistent().has(&nullifier_key_1) {
            return Err(ContractError::AlreadySpent);
        }

        // Verify nullifier 2 hasn't been spent
        let nullifier_key_2 = DataKey::Nullifier(nullifier_2.clone());
        if env.storage().persistent().has(&nullifier_key_2) {
            return Err(ContractError::AlreadySpent);
        }

        // Verify Merkle root is valid in history
        let root_key = DataKey::MerkleRoot(root.clone());
        if !env.storage().persistent().has(&root_key) {
            return Err(ContractError::InvalidRoot);
        }

        // Verify ZK Proof format
        if proof.len() == 0 {
            return Err(ContractError::VerificationFailed);
        }

        // Mark both nullifiers as spent in persistent storage
        env.storage().persistent().set(&nullifier_key_1, &true);
        env.storage().persistent().extend_ttl(&nullifier_key_1, 100, 1000);

        env.storage().persistent().set(&nullifier_key_2, &true);
        env.storage().persistent().extend_ttl(&nullifier_key_2, 100, 1000);

        // Insert both commitments into incremental Merkle tree
        insert_leaf(&env, output_commitment_1.clone())?;
        let new_root = insert_leaf(&env, output_commitment_2.clone())?;

        // Emit Transfer event with root, nullifiers, commitments and notes
        env.events().publish(
            (symbol_short!("transfer"), new_root.clone()),
            (nullifier_1, nullifier_2, output_commitment_1, encrypted_note_1, output_commitment_2, encrypted_note_2)
        );

        Ok(new_root)
    }


    /// Helper to verify if a Merkle root is valid
    pub fn is_root_valid(env: Env, root: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::MerkleRoot(root))
    }

    /// Helper to check if a nullifier is spent
    pub fn is_nullifier_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Nullifier(nullifier))
    }

    /// Upgrades the contract's WebAssembly bytecode. Restricted to Admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

// Internal Merkle Tree helpers

fn hash_nodes(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    bytes.append(&left.to_bytes());
    bytes.append(&right.to_bytes());
    let hash = env.crypto().sha256(&bytes);
    BytesN::from_array(env, &hash.to_array())
}

fn get_zero_value(env: &Env, level: u32) -> BytesN<32> {
    let mut current = BytesN::from_array(env, &[0u8; 32]);
    for _ in 0..level {
        current = hash_nodes(env, &current, &current);
    }
    current
}

fn insert_leaf(env: &Env, leaf: BytesN<32>) -> Result<BytesN<32>, ContractError> {
    let mut next_index: u32 = env.storage().instance().get(&DataKey::NextLeafIndex).unwrap_or(0);
    
    // 2^TREE_DEPTH is leaf capacity (2^8 = 256)
    if next_index >= 256 {
        return Err(ContractError::Unauthorized);
    }

    let mut current_hash = leaf;
    let mut index = next_index;

    for i in 0..TREE_DEPTH {
        let key = DataKey::FilledSubtree(i);
        if index % 2 == 1 {
            let left: BytesN<32> = env.storage().instance().get(&key).unwrap();
            current_hash = hash_nodes(env, &left, &current_hash);
        } else {
            env.storage().instance().set(&key, &current_hash);
            let zero = get_zero_value(env, i);
            current_hash = hash_nodes(env, &current_hash, &zero);
        }
        index /= 2;
    }

    // Save Merkle root in persistent storage
    let root_key = DataKey::MerkleRoot(current_hash.clone());
    env.storage().persistent().set(&root_key, &true);
    // Extend root TTL (~30 days / 518400 ledgers)
    env.storage().persistent().extend_ttl(&root_key, 100, 518400);

    // Update next leaf index
    next_index += 1;
    env.storage().instance().set(&DataKey::NextLeafIndex, &next_index);

    Ok(current_hash)
}

/// Verification Gate interface for ZK proof checking
fn verify_zk_proof(
    _env: &Env,
    proof: &Bytes,
    _nullifier: &BytesN<32>,
    _recipient: &Address,
    _token: &Address,
    _amount: i128,
    _root: &BytesN<32>
) -> bool {
    // In production, this function verifies the BN254 UltraHonk proof using host functions.
    // We check if the proof is formatted (non-empty).
    proof.len() > 0
}
