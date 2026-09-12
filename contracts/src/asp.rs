use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AspError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidRoot = 4,
    AddressBlocked = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    ExclusionRoot,
    HistoricalRoot(BytesN<32>),
    BlockedAddress(Address),
}

#[contractclient(name = "AspClient")]
pub trait AspInterface {
    fn initialize_asp(env: Env, admin: Address, initial_root: BytesN<32>) -> Result<(), AspError>;
    fn update_exclusion_root(env: Env, new_root: BytesN<32>) -> Result<(), AspError>;
    fn is_asp_root_valid(env: Env, root: BytesN<32>) -> bool;
    fn block_address(env: Env, target: Address) -> Result<(), AspError>;
    fn unblock_address(env: Env, target: Address) -> Result<(), AspError>;
    fn is_address_blocked(env: Env, target: Address) -> bool;
    fn get_exclusion_root(env: Env) -> Result<BytesN<32>, AspError>;
    fn set_admin(env: Env, new_admin: Address) -> Result<(), AspError>;
}

#[contract]
pub struct AssociationSetProvider;

#[contractimpl]
impl AspInterface for AssociationSetProvider {
    /// Initializes the ASP contract with an admin and an initial exclusion Merkle root
    fn initialize_asp(env: Env, admin: Address, initial_root: BytesN<32>) -> Result<(), AspError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AspError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ExclusionRoot, &initial_root);

        // Record initial root in historical roots cache with TTL
        let root_key = DataKey::HistoricalRoot(initial_root.clone());
        env.storage().persistent().set(&root_key, &true);
        env.storage().persistent().extend_ttl(&root_key, 100, 518400);

        env.events().publish(
            (symbol_short!("asp_init"), admin),
            initial_root
        );

        Ok(())
    }

    /// Updates the Merkle root of excluded/sanctioned public keys (called by compliance relayer/oracle)
    fn update_exclusion_root(env: Env, new_root: BytesN<32>) -> Result<(), AspError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(AspError::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::ExclusionRoot, &new_root);

        // Save into historical roots so in-flight proofs remain valid for ~30 days
        let root_key = DataKey::HistoricalRoot(new_root.clone());
        env.storage().persistent().set(&root_key, &true);
        env.storage().persistent().extend_ttl(&root_key, 100, 518400);

        env.events().publish(
            (symbol_short!("root_upd"),),
            new_root
        );

        Ok(())
    }

    /// Verifies if a given exclusion root is currently or recently valid
    fn is_asp_root_valid(env: Env, root: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::HistoricalRoot(root))
    }

    /// Directly blacklists a Stellar account address from receiving or depositing funds
    fn block_address(env: Env, target: Address) -> Result<(), AspError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(AspError::NotInitialized)?;
        admin.require_auth();

        let key = DataKey::BlockedAddress(target.clone());
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events().publish(
            (symbol_short!("blocked"),),
            target
        );

        Ok(())
    }

    /// Unblocks a previously blacklisted address upon successful remediation/appeal
    fn unblock_address(env: Env, target: Address) -> Result<(), AspError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(AspError::NotInitialized)?;
        admin.require_auth();

        let key = DataKey::BlockedAddress(target.clone());
        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("unblock"),),
            target
        );

        Ok(())
    }

    /// Queries whether a given Stellar account address is directly blacklisted
    fn is_address_blocked(env: Env, target: Address) -> bool {
        let key = DataKey::BlockedAddress(target);
        env.storage().persistent().has(&key)
    }

    /// Returns the current active exclusion Merkle root
    fn get_exclusion_root(env: Env) -> Result<BytesN<32>, AspError> {
        env.storage().instance().get(&DataKey::ExclusionRoot).ok_or(AspError::NotInitialized)
    }

    /// Updates the admin authority for ASP management
    fn set_admin(env: Env, new_admin: Address) -> Result<(), AspError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(AspError::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("new_adm"),),
            new_admin
        );

        Ok(())
    }
}
