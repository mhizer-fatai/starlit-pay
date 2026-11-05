import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { createZkKeysService, verifyZkKeys, zkKeysMessage } from "../src/modules/zk_keys/service.js";
import { publishKeysRequest } from "../src/modules/zk_keys/routes.js";

const wallet = S.Keypair.random();
const noteKey = `0x${"ab".repeat(32)}`;
const encryptionKey = `0x${"cd".repeat(32)}`;
const signed = (kp = wallet, note = noteKey, enc = encryptionKey) => ({
  noteKey: note,
  encryptionKey: enc,
  signature: kp.signMessage(zkKeysMessage(note, enc)).toString("base64"),
});

function memoryRepo(users) {
  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async findByUsername(name) {
      return users.find((u) => u.username === name) ?? null;
    },
    async saveKeys(id, fields) {
      if (users.some((u) => u.id !== id && u.zk_note_key === fields.zk_note_key)) return null;
      const user = users.find((u) => u.id === id);
      Object.assign(user, fields);
      return user;
    },
  };
}

const alice = () => ({ id: "a", username: "alice", stellar_address: wallet.publicKey() });
const rejects = (promise, status) => assert.rejects(promise, (err) => err.status === status);

test("a user publishes keys signed by their wallet; senders get them with the signature", async () => {
  const service = createZkKeysService({ repository: memoryRepo([alice()]) });
  await service.publish("a", signed());
  const found = await service.lookup("alice");
  assert.equal(found.noteKey, noteKey);
  assert.equal(found.stellarAddress, wallet.publicKey());
  assert.ok(verifyZkKeys(found.stellarAddress, found), "the sender can check the binding itself");
});

test("keys signed by any other key are refused (a stolen session can't swap them)", async () => {
  const service = createZkKeysService({ repository: memoryRepo([alice()]) });
  await rejects(service.publish("a", signed(S.Keypair.random())), 403);
  const tampered = { ...signed(), encryptionKey: `0x${"ee".repeat(32)}` };
  await rejects(service.publish("a", tampered), 403);
});

test("older accounts sign with the G key kept in public_encryption_key", async () => {
  const service = createZkKeysService({ repository: memoryRepo([{ id: "o", username: "old", public_encryption_key: wallet.publicKey() }]) });
  await service.publish("o", signed());
  assert.equal((await service.lookup("old")).stellarAddress, wallet.publicKey());
});

test("accounts without a wallet key, taken note keys and users without keys", async () => {
  const other = S.Keypair.random();
  const users = [alice(), { id: "b", username: "bob", stellar_address: other.publicKey() }, { id: "n", username: "nokey", public_encryption_key: "ab".repeat(32) }];
  const service = createZkKeysService({ repository: memoryRepo(users) });
  await rejects(service.publish("n", signed()), 400);
  await service.publish("a", signed());
  await rejects(service.publish("b", signed(other)), 409);
  await rejects(service.lookup("bob"), 404);
  await rejects(service.lookup("nobody"), 404);
});

test("the signed text matches the app's, byte for byte (see frontend zkSigner.test.ts)", () => {
  assert.equal(zkKeysMessage(`0x${"AB".repeat(32)}`, `0x${"cd".repeat(32)}`), `Starlit Pay private keys\nnote: 0x${"ab".repeat(32)}\nencryption: 0x${"cd".repeat(32)}`);
});

test("request shape: 0x-prefixed 32-byte keys and a 64-byte base64 signature", () => {
  assert.ok(publishKeysRequest.safeParse(signed()).success);
  assert.ok(!publishKeysRequest.safeParse({ ...signed(), noteKey: "ab".repeat(32) }).success);
  assert.ok(!publishKeysRequest.safeParse({ ...signed(), signature: "abc" }).success);
});
