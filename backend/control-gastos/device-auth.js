"use strict";

const crypto = require("crypto");
const { nowIso, sha256 } = require("./storage");

const AR_EMAIL = "fernandoemacchi@gmail.com";
const ACCESS_TTL_SEC = Number(process.env.CONTROL_GASTOS_DEVICE_ACCESS_TTL_SEC || 900); // 15 min
const REFRESH_TTL_SEC = Number(process.env.CONTROL_GASTOS_DEVICE_REFRESH_TTL_SEC || 30 * 24 * 3600); // 30 days
const SECRET = process.env.CONTROL_GASTOS_DEVICE_TOKEN_SECRET || "DEV_ONLY_CHANGE_ME_CONTROL_GASTOS";

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function b64urlDecode(s) { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); const pad = s.length % 4 ? 4 - (s.length % 4) : 0; return Buffer.from(s + "=".repeat(pad), "base64"); }
function sign(data) { return b64url(crypto.createHmac("sha256", SECRET).update(data).digest()); }

function issueAccessToken(deviceId, scope = "sync_operational") {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload = { sub: String(deviceId), scope, iat: now, exp: now + ACCESS_TTL_SEC, jti, typ: "cg_device_access" };
  const body = b64url(JSON.stringify({ alg: "HS256", typ: "CGAT" })) + "." + b64url(JSON.stringify(payload));
  return { token: body + "." + sign(body), payload };
}

function verifyAccessToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return { ok: false, error: "malformed" };
    const [h, p, s] = parts;
    const body = h + "." + p;
    const expected = sign(body);
    const a = Buffer.from(s); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: "bad_signature" };
    const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= Number(payload.exp)) return { ok: false, error: "expired", payload };
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: "invalid" };
  }
}

function randomToken(bytes = 32) { return b64url(crypto.randomBytes(bytes)); }

async function registerDevice(store, { label, createdBy }) {
  if (String(createdBy || "").toLowerCase() !== AR_EMAIL) return { ok: false, status: 403, error: "forbidden" };
  const deviceId = crypto.randomUUID();
  const refreshToken = randomToken(32);
  const refreshId = crypto.randomUUID();
  const now = nowIso();
  const refreshRec = {
    deviceId,
    refreshId,
    hash: sha256(refreshToken),
    createdAt: now,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString(),
    rotatedFrom: null,
    revoked: false,
  };
  const device = {
    id: deviceId,
    label: String(label || "hermes-sync-device"),
    status: "active",
    createdAt: now,
    createdBy,
    lastSeenAt: null,
    currentRefreshId: refreshId,
    scope: "sync_operational",
  };
  await store.upsertDevice(device);
  await store.setDeviceRefresh(deviceId, refreshRec);
  await store.addAudit({ type: "device_registered", deviceId, label: device.label, by: createdBy });
  // Return plaintext refresh token ONCE (client must store in Windows Credential Manager/DPAPI)
  return { ok: true, device: { id: deviceId, label: device.label, scope: device.scope, status: device.status }, credentials: { deviceId, refreshToken, refreshExpiresAt: refreshRec.expiresAt, tokenEndpointHint: "/api/control-gastos/devices/token" } };
}

async function refreshDeviceToken(store, { deviceId, refreshToken }, meta = {}) {
  if (typeof store.rotateDeviceRefresh !== "function") return { ok:false, status:503, error:"atomic_refresh_unavailable" };
  // Anti-reuse / rotation: rotate refresh token on every use
  const newRefresh = randomToken(32);
  const newRefreshId = crypto.randomUUID();
  const newRec = {
    deviceId,
    refreshId: newRefreshId,
    hash: sha256(newRefresh),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString(),
    revoked: false,
  };
  const rotation = await store.rotateDeviceRefresh(deviceId, refreshToken ? sha256(refreshToken) : null, newRec);
  if (!rotation.ok) {
    await store.addAudit({ type: "device_refresh_failed", deviceId, reason: rotation.error, ...meta });
    return rotation;
  }
  const device = rotation.device;
  const access = issueAccessToken(deviceId, device.scope || "sync_operational");
  await store.addAudit({ type: "device_token_issued", deviceId, accessJti: access.payload.jti, refreshRotated: true, ...meta });
  return {
    ok: true,
    accessToken: access.token,
    accessExpiresInSec: ACCESS_TTL_SEC,
    accessExpiresAt: new Date(access.payload.exp * 1000).toISOString(),
    refreshToken: newRefresh,
    refreshExpiresAt: newRec.expiresAt,
    deviceId,
    scope: device.scope || "sync_operational",
  };
}

async function revokeDevice(store, { deviceId, by }) {
  if (String(by || "").toLowerCase() !== AR_EMAIL) return { ok: false, status: 403, error: "forbidden" };
  if (typeof store.revokeDeviceAtomic !== "function") return { ok:false, status:503, error:"atomic_revoke_unavailable" };
  const device = await store.revokeDeviceAtomic(deviceId, by);
  if (!device) return { ok: false, status: 404, error: "device_not_found" };
  await store.addAudit({ type: "device_revoked", deviceId, by });
  return { ok: true, device };
}

async function authenticateDeviceAccess(store, req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  // Heuristic: device tokens are our HMAC tokens (3 parts, base64url). Firebase ID tokens are JWTs but verified elsewhere; we only accept if our verify passes.
  const v = verifyAccessToken(token);
  if (!v.ok) return null;
  const p = v.payload || {};
  if (p.typ !== "cg_device_access") return null;
  if (p.scope !== "sync_operational") return { ok: false, status: 403, error: "invalid_scope" };
  const device = await store.getDevice(p.sub);
  if (!device || device.status !== "active") return { ok: false, status: 403, error: "device_revoked_or_inactive" };
  // jti revocation check (if explicitly revoked)
  const revoked = await store.getDeviceRevoked(p.jti);
  if (revoked) return { ok: false, status: 403, error: "token_revoked" };
  return { ok: true, device, payload: p, authType: "device_sync" };
}

module.exports = { registerDevice, refreshDeviceToken, revokeDevice, authenticateDeviceAccess, verifyAccessToken, issueAccessToken, AR_EMAIL };
