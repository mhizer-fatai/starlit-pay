import crypto from "node:crypto";
import { HttpError } from "../../http/errors.js";

// Accounts: finding an account for a signed-in Google email, the PIN check that
// lets an old email+PIN account upgrade to a passkey, registration, lookup by
// username (to pay someone), and editing one's own profile. Sessions are
// issued only by the passkey layer (auth_layer), never here.

/** Profile fields safe to return to the account owner: never the login commitment. */
const ownerView = ({ identity_commitment: _secret, ...user }) => user;

const sameSecret = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export function createUsersService({ repository, emailProofRequired, randomMemo = () => crypto.randomInt(100_000, 1_000_000) }) {
  /**
   * Only the owner of an email may ask about its account: Google sign-in proves
   * it. Without this, anyone could test any email address.
   */
  function assertEmailOwner(email, proven) {
    if (emailProofRequired && proven !== email) {
      throw new HttpError(401, "Sign in with Google to continue.", "email_proof_required");
    }
  }

  async function uniqueDepositMemo() {
    for (let attempt = 0; attempt < 15; attempt++) {
      const memo = randomMemo();
      if (!(await repository.depositMemoTaken(memo))) return memo;
    }
    throw new Error("Failed to generate a unique deposit memo.");
  }

  return {
    /** Without a commitment: does this email have an account? With one: the old PIN check. */
    async login({ email, identity_commitment: commitment }, proven) {
      assertEmailOwner(email, proven);
      const user = await repository.findByEmail(email);
      if (!user) return { exists: false };
      if (!commitment) {
        return { exists: true, user: { username: user.username, display_name: user.display_name, avatar_url: user.avatar_url } };
      }
      if (!sameSecret(commitment, user.identity_commitment)) throw new HttpError(401, "Incorrect PIN.");
      return { exists: true, user: ownerView(user) };
    },

    async register(input, proven) {
      assertEmailOwner(input.email, proven);
      const user = await repository.insert({
        email: input.email,
        username: input.username,
        display_name: input.display_name || input.username,
        identity_commitment: input.identity_commitment,
        public_encryption_key: input.public_encryption_key,
        avatar_url: input.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(input.username)}`,
        stellar_address: input.stellar_address ?? null,
        deposit_memo: await uniqueDepositMemo(),
      });
      if (!user) throw new HttpError(400, "Username or email already exists");
      return ownerView(user);
    },

    async lookup(username) {
      const user = await repository.findPublicByUsername(username);
      if (!user) throw new HttpError(404, "User not found");
      return user;
    },

    /** Display name and avatar only: email and username are identity and never change here. */
    async updateProfile(userId, fields) {
      const user = await repository.update(userId, fields);
      if (!user) throw new HttpError(404, "User not found.");
      return ownerView(user);
    },
  };
}
