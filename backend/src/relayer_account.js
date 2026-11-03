// One relayer account pays for pool payments, smart-wallet transactions and
// the TTL keeper. Every transaction takes the account's next sequence number,
// so two built at the same time collide and one is rejected. They take turns:
// the next one starts once the previous is confirmed or has failed.

export function createSerialQueue() {
  let tail = Promise.resolve();
  return function run(task) {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

export const withRelayerAccount = createSerialQueue();

/** Polls until the network has an outcome (SUCCESS or FAILED), or gives up as NOT_FOUND. */
export async function waitForTransaction(rpc, hash, { attempts = 30, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const result = await rpc.getTransaction(hash);
    if (result.status !== "NOT_FOUND") return result;
    await sleep(1000);
  }
  return { status: "NOT_FOUND" };
}
