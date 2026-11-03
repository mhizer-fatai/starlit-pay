// A Merkle root the shielded pool currently accepts. Spends need one, but notes
// posted by clients (received payments, change) are stored without a root, and
// the pool accepts any root it has recorded. The newest roots seen by the
// indexer are checked on-chain with is_root_valid before one is returned.

const CACHE_TTL_MS = 60_000;
const CANDIDATES = 10;

export function createPoolRootService({ recentRoots, isRootValid, configured = true, now = Date.now }) {
  let cache = { root: null, at: 0 };

  return {
    async current() {
      if (cache.root && now() - cache.at < CACHE_TTL_MS) return cache.root;
      if (!configured) return null;
      const seen = new Set();
      for (const root of await recentRoots(CANDIDATES)) {
        if (!/^[0-9a-f]{64}$/.test(root) || seen.has(root)) continue;
        seen.add(root);
        if (await isRootValid(root)) {
          cache = { root, at: now() };
          return root;
        }
      }
      return null;
    },
  };
}
