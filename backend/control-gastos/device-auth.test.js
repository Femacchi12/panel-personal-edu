"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MemoryStore } = require("./storage");
const auth = require("./device-auth");

test("isolated device registration, refresh rotation, replay rejection and revocation", async () => {
  const store = new MemoryStore();
  const registered = await auth.registerDevice(store, { label: "isolated-test", createdBy: auth.AR_EMAIL });
  assert.equal(registered.ok, true);
  const { deviceId, refreshToken } = registered.credentials;
  const refreshed = await auth.refreshDeviceToken(store, { deviceId, refreshToken });
  assert.equal(refreshed.ok, true);
  assert.notEqual(refreshed.refreshToken, refreshToken);
  const replay = await auth.refreshDeviceToken(store, { deviceId, refreshToken });
  assert.equal(replay.error, "invalid_refresh_token");
  const request = { headers: { authorization: `Bearer ${refreshed.accessToken}` } };
  assert.equal((await auth.authenticateDeviceAccess(store, request)).ok, true);
  assert.equal((await auth.revokeDevice(store, { deviceId, by: auth.AR_EMAIL })).ok, true);
  assert.equal((await auth.authenticateDeviceAccess(store, request)).error, "device_revoked_or_inactive");
  assert.equal((await auth.refreshDeviceToken(store, { deviceId, refreshToken: refreshed.refreshToken })).error, "device_revoked_or_inactive");
});
