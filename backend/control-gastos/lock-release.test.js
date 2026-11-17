"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MemoryStore } = require("./storage");
const { MovimientosWriter } = require("./movimientos-writer");

test("an expired holder cannot release a replacement holder's lock", async () => {
  const store = new MemoryStore();
  const writer = new MovimientosWriter({ store });
  const first = await writer._acquireLock("isolated");
  assert.equal(first.ok, true);
  await store.setIdempotency(first.lockKey, { ...first.lock, expiresAt: Date.now() - 1 });
  const second = await writer._acquireLock("isolated");
  assert.equal(second.ok, true);
  await writer._releaseLock(first);
  const current = await store.getIdempotency(first.lockKey);
  assert.equal(current.lockId, second.lock.lockId);
  assert.ok(current.expiresAt > Date.now());
  await writer._releaseLock(second);
  assert.ok((await store.getIdempotency(first.lockKey)).expiresAt < Date.now());
});
