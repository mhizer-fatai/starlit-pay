use dep::std;

fn main(
    // Public Inputs (On-Chain Visible)
    input_commitment_1: pub Field,
    input_commitment_2: pub Field,
    nullifier_1: pub Field,
    nullifier_2: pub Field,
    output_commitment_1: pub Field,
    output_commitment_2: pub Field,
    token_address: pub Field,

    // Private Inputs (Hidden from Blockchain)
    input_amount_1: Field,
    input_amount_2: Field,
    output_amount_1: Field,
    output_amount_2: Field,
    input_secret_1: Field,
    input_secret_2: Field,
    output_secret_1: Field,
    output_secret_2: Field,
    input_owner_1: Field,
    input_owner_2: Field,
    output_recipient_1: Field,
    output_recipient_2: Field
) {
    // 1. Verify derivation of Input Commitment 1 and Nullifier 1
    let derived_input_commitment_1 = std::hash::poseidon::bn254::hash_4([
        input_amount_1,
        input_owner_1,
        token_address,
        input_secret_1
    ]);
    assert(derived_input_commitment_1 == input_commitment_1);

    let derived_nullifier_1 = std::hash::poseidon::bn254::hash_2([
        input_secret_1,
        input_commitment_1
    ]);
    assert(derived_nullifier_1 == nullifier_1);

    // 2. Verify derivation of Input Commitment 2 and Nullifier 2
    let derived_input_commitment_2 = std::hash::poseidon::bn254::hash_4([
        input_amount_2,
        input_owner_2,
        token_address,
        input_secret_2
    ]);
    assert(derived_input_commitment_2 == input_commitment_2);

    let derived_nullifier_2 = std::hash::poseidon::bn254::hash_2([
        input_secret_2,
        input_commitment_2
    ]);
    assert(derived_nullifier_2 == nullifier_2);

    // 3. Verify derivation of Output Commitment 1
    let derived_output_commitment_1 = std::hash::poseidon::bn254::hash_4([
        output_amount_1,
        output_recipient_1,
        token_address,
        output_secret_1
    ]);
    assert(derived_output_commitment_1 == output_commitment_1);

    // 4. Verify derivation of Output Commitment 2
    let derived_output_commitment_2 = std::hash::poseidon::bn254::hash_4([
        output_amount_2,
        output_recipient_2,
        token_address,
        output_secret_2
    ]);
    assert(derived_output_commitment_2 == output_commitment_2);

    // 5. Value Conservation (Sum of inputs must equal sum of outputs)
    assert(input_amount_1 + input_amount_2 == output_amount_1 + output_amount_2);
}
