"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let admin = null;
let getFirestore = null;
try {
  admin = require("firebase-admin");
  try { ({ getFirestore } = require("firebase-admin/firestore")); } catch (_) { getFirestore = null; }
} catch (_) { admin = null; getFirestore = null; }

function nowIso() { return new Date().toISOString(); }
function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
function idemKey(req, body) {
  const h = String(req.headers["x-idempotency-key"] || body?.idempotencyKey || "").trim();
  return h || null;
}
function hashPayload(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj || null)).digest("hex");
}
function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

class MemoryStore {
  constructor(seed) {
    this.data = {
      pendings: [],
      closures: {},
      reviews: {},
      corrections: { proposals: [], applied: [] },
      audits: [],
      idempotency: {},
      syncState: { lastSyncAt: null, pendingSyncCount: 0, status: "local_test", source: "memory" },
      devices: {},
      deviceRefresh: {},
      deviceRevoked: {},
      ...(seed || {})
    };
  }
  async getState() { return deepClone(this.data); }
  async saveState(next) { this.data = deepClone(next); return this.data; }
  async getPendings() { return deepClone(this.data.pendings || []); }
  async setPendings(items) { this.data.pendings = deepClone(items); return this.data.pendings; }
  async getPendingById(id) { return deepClone((this.data.pendings || []).find(p => String(p.id) === String(id) || String(p.message_key) === String(id)) || null); }
  async upsertPending(item) {
    const items = this.data.pendings || [];
    const key = String(item.id || item.message_key);
    const i = items.findIndex(p => String(p.id) === key || String(p.message_key) === key);
    if (i >= 0) items[i] = { ...items[i], ...deepClone(item), updated_at: nowIso() }; else items.push({ ...deepClone(item), updated_at: nowIso() });
    this.data.pendings = items; return deepClone(items[i >= 0 ? i : items.length - 1]);
  }
  async getClosures() { return deepClone(this.data.closures || {}); }
  async setClosures(closures) { this.data.closures = deepClone(closures); return this.data.closures; }
  async getClosure(date) { return deepClone((this.data.closures || {})[date] || null); }
  async upsertClosure(date, closure) { this.data.closures = this.data.closures || {}; this.data.closures[date] = deepClone(closure); return this.data.closures[date]; }
  async getReviews() { return deepClone(this.data.reviews || {}); }
  async setReview(date, review) { this.data.reviews = this.data.reviews || {}; this.data.reviews[date] = deepClone(review); return this.data.reviews[date]; }
  async getCorrections() { return deepClone(this.data.corrections || { proposals: [], applied: [] }); }
  async setCorrections(c) { this.data.corrections = deepClone(c); return this.data.corrections; }
  async addAudit(entry) { this.data.audits = this.data.audits || []; this.data.audits.push({ id: crypto.randomUUID(), at: nowIso(), ...deepClone(entry) }); return this.data.audits[this.data.audits.length - 1]; }
  async listAudits(limit = 200) { return deepClone((this.data.audits || []).slice(-limit).reverse()); }
  async getIdempotency(key) { return deepClone((this.data.idempotency || {})[key] || null); }
  async setIdempotency(key, value) { this.data.idempotency = this.data.idempotency || {}; this.data.idempotency[key] = deepClone(value); return value; }
  async acquireIdempotencyLock(key, opts = {}) {
    const now = Date.now();
    const ttlMs = Number(opts.ttlMs || 120000);
    const existing = (this.data.idempotency || {})[key] || null;
    if (existing && existing.expiresAt && now < Number(existing.expiresAt)) {
      return { ok: false, status: 409, error: "concurrency_locked", lock: deepClone(existing) };
    }
    const lock = { lockId: crypto.randomUUID(), holder: opts.holder || "writer", at: nowIso(), expiresAt: now + ttlMs };
    this.data.idempotency = this.data.idempotency || {}; this.data.idempotency[key] = deepClone(lock);
    return { ok: true, lock };
  }
  async releaseIdempotencyLock(key, lockId) {
    const current = (this.data.idempotency || {})[key];
    if (!current || current.lockId !== lockId) return false;
    this.data.idempotency[key] = { ...current, releasedAt: nowIso(), expiresAt: Date.now() - 1 };
    return true;
  }
  async reserveIdempotencyKey(key, opts = {}) {
    const now = Date.now();
    const ttlMs = Number(opts.ttlMs || 120000);
    const existing = (this.data.idempotency || {})[key] || null;
    if (existing && existing.status === "committed") return { ok: false, error: "duplicate_fila_origen_reserved", status: "committed", reservation: deepClone(existing) };
    if (existing && existing.status === "reserved" && existing.expiresAt && now < Number(existing.expiresAt) && existing.opKey !== opts.opKey) {
      return { ok: false, error: "fila_origen_inflight", reservation: deepClone(existing) };
    }
    const rec = { status: "reserved", opKey: opts.opKey || null, at: nowIso(), expiresAt: now + ttlMs, ...(opts.meta || {}) };
    this.data.idempotency = this.data.idempotency || {}; this.data.idempotency[key] = deepClone(rec);
    return { ok: true, reserved: true, reservation: rec };
  }
  async getSyncState() { return deepClone(this.data.syncState || {}); }
  async setSyncState(s) { this.data.syncState = { ...(this.data.syncState || {}), ...deepClone(s) }; return this.data.syncState; }

  // Device auth (sync operativo, alcance limitado)
  async listDevices() { return Object.values(deepClone(this.data.devices || {})); }
  async getDevice(id) { return deepClone((this.data.devices || {})[String(id)] || null); }
  async upsertDevice(device) { this.data.devices = this.data.devices || {}; const id = String(device.id); this.data.devices[id] = { ...(this.data.devices[id]||{}), ...deepClone(device), id }; return deepClone(this.data.devices[id]); }
  async getDeviceRefresh(deviceId) { return deepClone((this.data.deviceRefresh || {})[String(deviceId)] || null); }
  async setDeviceRefresh(deviceId, rec) { this.data.deviceRefresh = this.data.deviceRefresh || {}; this.data.deviceRefresh[String(deviceId)] = deepClone(rec); return this.data.deviceRefresh[String(deviceId)]; }
  async rotateDeviceRefresh(deviceId, expectedHash, next) {
    const device = this.data.devices[String(deviceId)];
    const rec = this.data.deviceRefresh[String(deviceId)];
    if (!device) return { ok:false, status:404, error:"device_not_found" };
    if (device.status !== "active") return { ok:false, status:403, error:"device_revoked_or_inactive" };
    if (!rec || rec.revoked) return { ok:false, status:403, error:"refresh_revoked" };
    if (rec.expiresAt && Date.now() >= Date.parse(rec.expiresAt)) return { ok:false, status:403, error:"refresh_expired" };
    if (!expectedHash || expectedHash !== rec.hash) return { ok:false, status:401, error:"invalid_refresh_token" };
    const old = rec.refreshId;
    this.data.deviceRefresh[String(deviceId)] = { ...deepClone(next), rotatedFrom:old };
    this.data.deviceRevoked[old] = { deviceId, refreshId:old, revokedAt:nowIso(), reason:"rotated" };
    device.currentRefreshId = next.refreshId;
    device.lastSeenAt = nowIso();
    return { ok:true, device:deepClone(device) };
  }
  async revokeDeviceAtomic(deviceId, by) {
    const device = this.data.devices[String(deviceId)];
    if (!device) return null;
    Object.assign(device, { status:"revoked", revokedAt:nowIso(), revokedBy:by });
    const rec = this.data.deviceRefresh[String(deviceId)];
    if (rec) {
      rec.revoked = true; rec.revokedAt = nowIso();
      if (rec.refreshId) this.data.deviceRevoked[rec.refreshId] = { deviceId, refreshId:rec.refreshId, revokedAt:nowIso(), reason:"device_revoked" };
    }
    return deepClone(device);
  }
  async getDeviceRevoked(jti) { return deepClone((this.data.deviceRevoked || {})[String(jti)] || null); }
  async setDeviceRevoked(jti, rec) { this.data.deviceRevoked = this.data.deviceRevoked || {}; this.data.deviceRevoked[String(jti)] = deepClone(rec); return this.data.deviceRevoked[String(jti)]; }
}

class FileStore extends MemoryStore {
  constructor(filePath, seed) {
    super(seed);
    this.filePath = filePath;
    this._loaded = false;
  }
  async _ensure() {
    if (this._loaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        this.data = { ...this.data, ...(JSON.parse(raw) || {}) };
      } else {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
      }
    } catch (_) { /* keep seed */ }
    this._loaded = true;
  }
  async _persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.filePath);
    } catch (_) {}
  }
  async getState() { await this._ensure(); return super.getState(); }
  async saveState(next) { await this._ensure(); const r = await super.saveState(next); await this._persist(); return r; }
  async getPendings() { await this._ensure(); return super.getPendings(); }
  async setPendings(items) { await this._ensure(); const r = await super.setPendings(items); await this._persist(); return r; }
  async getPendingById(id) { await this._ensure(); return super.getPendingById(id); }
  async upsertPending(item) { await this._ensure(); const r = await super.upsertPending(item); await this._persist(); return r; }
  async getClosures() { await this._ensure(); return super.getClosures(); }
  async setClosures(c) { await this._ensure(); const r = await super.setClosures(c); await this._persist(); return r; }
  async getClosure(d) { await this._ensure(); return super.getClosure(d); }
  async upsertClosure(d,c) { await this._ensure(); const r = await super.upsertClosure(d,c); await this._persist(); return r; }
  async getReviews() { await this._ensure(); return super.getReviews(); }
  async setReview(d,r) { await this._ensure(); const x = await super.setReview(d,r); await this._persist(); return x; }
  async getCorrections() { await this._ensure(); return super.getCorrections(); }
  async setCorrections(c) { await this._ensure(); const r = await super.setCorrections(c); await this._persist(); return r; }
  async addAudit(e) { await this._ensure(); const r = await super.addAudit(e); await this._persist(); return r; }
  async listAudits(l) { await this._ensure(); return super.listAudits(l); }
  async getIdempotency(k) { await this._ensure(); return super.getIdempotency(k); }
  async setIdempotency(k,v) { await this._ensure(); const r = await super.setIdempotency(k,v); await this._persist(); return r; }
  async acquireIdempotencyLock(k, opts) { await this._ensure(); const r = await super.acquireIdempotencyLock(k, opts); await this._persist(); return r; }
  async releaseIdempotencyLock(k, lockId) { await this._ensure(); const r = await super.releaseIdempotencyLock(k, lockId); if (r) await this._persist(); return r; }
  async reserveIdempotencyKey(k, opts) { await this._ensure(); const r = await super.reserveIdempotencyKey(k, opts); await this._persist(); return r; }
  async getSyncState() { await this._ensure(); return super.getSyncState(); }
  async setSyncState(s) { await this._ensure(); const r = await super.setSyncState(s); await this._persist(); return r; }

  async listDevices() { await this._ensure(); return super.listDevices(); }
  async getDevice(id) { await this._ensure(); return super.getDevice(id); }
  async upsertDevice(d) { await this._ensure(); const r = await super.upsertDevice(d); await this._persist(); return r; }
  async getDeviceRefresh(id) { await this._ensure(); return super.getDeviceRefresh(id); }
  async setDeviceRefresh(id, r) { await this._ensure(); const x = await super.setDeviceRefresh(id, r); await this._persist(); return x; }
  async rotateDeviceRefresh(id, hash, next) { await this._ensure(); const r = await super.rotateDeviceRefresh(id, hash, next); await this._persist(); return r; }
  async revokeDeviceAtomic(id, by) { await this._ensure(); const r = await super.revokeDeviceAtomic(id, by); await this._persist(); return r; }
  async getDeviceRevoked(j) { await this._ensure(); return super.getDeviceRevoked(j); }
  async setDeviceRevoked(j, r) { await this._ensure(); const x = await super.setDeviceRevoked(j, r); await this._persist(); return x; }
}

// Firestore adapter (operational state only). Requires firestore.googleapis.com + database + IAM on runtime SA.
// Collections (prefix configurable): pendings, closures, reviews, correctionProposals, correctionApplied, audits, idempotency, meta, devices, deviceRefresh, deviceRevoked
class FirestoreStore {
  constructor(opts = {}) {
    if (!admin || !admin.apps || !admin.apps.length) throw new Error("firebase-admin not initialized");
    const dbName = opts.databaseId || process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)";
    if (dbName && dbName !== "(default)" && getFirestore) this.db = getFirestore(admin.app(), dbName);
    else this.db = admin.firestore(); // (default) fallback
    this.databaseId = dbName;
    this.projectId = (admin.app().options && admin.app().options.projectId) || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null;
    const p = opts.prefix || "control_gastos";
    this.col = (name) => this.db.collection(`${p}_${name}`);
    this.doc = (name, id) => this.col(name).doc(String(id));
  }
  async getState() {
    const [pendings, closures, reviews, corr, audits, sync] = await Promise.all([
      this.getPendings(), this.getClosures(), this.getReviews(), this.getCorrections(), this.listAudits(500), this.getSyncState()
    ]);
    return { pendings, closures, reviews, corrections: corr, audits, idempotency: {}, syncState: sync };
  }
  async saveState(next) {
    // best-effort bulk (dev use); prefer granular ops
    const batchOps = [];
    if (Array.isArray(next.pendings)) await this.setPendings(next.pendings);
    if (next.closures) await this.setClosures(next.closures);
    if (next.reviews) { for (const [d,r] of Object.entries(next.reviews)) await this.setReview(d,r); }
    if (next.corrections) await this.setCorrections(next.corrections);
    if (next.syncState) await this.setSyncState(next.syncState);
    return this.getState();
  }
  async getPendings() {
    const snap = await this.col("pendings").get();
    return snap.docs.map(d => d.data());
  }
  async setPendings(items) {
    const batch = this.db.batch();
    const col = this.col("pendings");
    (items||[]).forEach(p => { const id = String(p.id || p.message_key || crypto.randomUUID()); batch.set(col.doc(id), { ...deepClone(p), id }, { merge: true }); });
    await batch.commit();
    return this.getPendings();
  }
  async getPendingById(id) {
    const key = String(id);
    const direct = await this.doc("pendings", key).get();
    if (direct.exists) return direct.data();
    const q = await this.col("pendings").where("message_key", "==", key).limit(1).get();
    return q.empty ? null : q.docs[0].data();
  }
  async upsertPending(item) {
    const id = String(item.id || item.message_key || crypto.randomUUID());
    const ref = this.doc("pendings", id);
    const prev = (await ref.get()).data() || {};
    const next = { ...prev, ...deepClone(item), id, updated_at: nowIso() };
    await ref.set(next, { merge: true });
    return next;
  }
  async getClosures() {
    const snap = await this.col("closures").get();
    const out = {};
    snap.docs.forEach(d => { out[d.id] = d.data()?.closure || d.data(); });
    return out;
  }
  async setClosures(closures) {
    const batch = this.db.batch();
    for (const [date, c] of Object.entries(closures||{})) batch.set(this.doc("closures", date), { date, closure: deepClone(c), updated_at: nowIso() }, { merge: true });
    await batch.commit();
    return this.getClosures();
  }
  async getClosure(date) {
    const d = await this.doc("closures", String(date)).get();
    if (!d.exists) return null;
    const data = d.data();
    return data.closure || data;
  }
  async upsertClosure(date, closure) {
    await this.doc("closures", String(date)).set({ date, closure: deepClone(closure), updated_at: nowIso() }, { merge: true });
    return closure;
  }
  async getReviews() {
    const snap = await this.col("reviews").get();
    const out = {};
    snap.docs.forEach(d => { out[d.id] = d.data()?.review || d.data(); });
    return out;
  }
  async setReview(date, review) {
    await this.doc("reviews", String(date)).set({ date, review: deepClone(review), updated_at: nowIso() }, { merge: true });
    return review;
  }
  async getCorrections() {
    const [pSnap, aSnap] = await Promise.all([this.col("correctionProposals").get(), this.col("correctionApplied").get()]);
    return { proposals: pSnap.docs.map(d=>d.data()), applied: aSnap.docs.map(d=>d.data()) };
  }
  async setCorrections(c) {
    const batch = this.db.batch();
    for (const p of (c.proposals||[])) batch.set(this.doc("correctionProposals", String(p.id || crypto.randomUUID())), deepClone(p), { merge: true });
    for (const a of (c.applied||[])) batch.set(this.doc("correctionApplied", String(a.id || crypto.randomUUID())), deepClone(a), { merge: true });
    await batch.commit();
    return this.getCorrections();
  }
  async addAudit(entry) {
    const id = crypto.randomUUID();
    const rec = { id, at: nowIso(), ...deepClone(entry) };
    await this.doc("audits", id).set(rec);
    return rec;
  }
  async listAudits(limit = 200) {
    const snap = await this.col("audits").orderBy("at", "desc").limit(limit).get().catch(async ()=> this.col("audits").limit(limit).get());
    return snap.docs.map(d=>d.data());
  }
  async getIdempotency(key) {
    const d = await this.doc("idempotency", String(key)).get();
    return d.exists ? d.data() : null;
  }
  async setIdempotency(key, value) {
    const rec = { key, ...deepClone(value), at: value?.at || nowIso() };
    await this.doc("idempotency", String(key)).set(rec, { merge: true });
    return rec;
  }
  async acquireIdempotencyLock(key, opts = {}) {
    const ref = this.doc("idempotency", String(key));
    const ttlMs = Number(opts.ttlMs || 120000);
    const holder = opts.holder || "writer";
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const existing = snap.exists ? (snap.data() || {}) : null;
      if (existing && existing.expiresAt && now < Number(existing.expiresAt)) {
        return { ok: false, status: 409, error: "concurrency_locked", lock: existing };
      }
      const lock = { key: String(key), lockId: crypto.randomUUID(), holder, at: nowIso(), expiresAt: now + ttlMs, type: "lock" };
      tx.set(ref, lock, { merge: false });
      return { ok: true, lock };
    });
  }
  async releaseIdempotencyLock(key, lockId) {
    const ref = this.doc("idempotency", String(key));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      if (!current || current.lockId !== lockId) return false;
      tx.update(ref, { releasedAt: nowIso(), expiresAt: Date.now() - 1 });
      return true;
    });
  }
  async reserveIdempotencyKey(key, opts = {}) {
    const ref = this.doc("idempotency", String(key));
    const ttlMs = Number(opts.ttlMs || 120000);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const existing = snap.exists ? (snap.data() || {}) : null;
      if (existing && existing.status === "committed") return { ok: false, error: "duplicate_fila_origen_reserved", status: "committed", reservation: existing };
      if (existing && existing.status === "reserved" && existing.expiresAt && now < Number(existing.expiresAt) && existing.opKey !== opts.opKey) {
        return { ok: false, error: "fila_origen_inflight", reservation: existing };
      }
      const rec = { key: String(key), status: "reserved", opKey: opts.opKey || null, at: nowIso(), expiresAt: now + ttlMs, ...(opts.meta || {}) };
      tx.set(ref, rec, { merge: false });
      return { ok: true, reserved: true, reservation: rec };
    });
  }
  async getSyncState() {
    const d = await this.doc("meta", "syncState").get();
    return d.exists ? d.data() : { lastSyncAt: null, pendingSyncCount: 0, status: "unknown", source: "firestore" };
  }
  async setSyncState(s) {
    const next = { ...(await this.getSyncState()), ...deepClone(s), updated_at: nowIso() };
    await this.doc("meta", "syncState").set(next, { merge: true });
    return next;
  }

  async listDevices() { const snap = await this.col("devices").get(); return snap.docs.map(d=>d.data()); }
  async getDevice(id) { const d = await this.doc("devices", String(id)).get(); return d.exists ? d.data() : null; }
  async upsertDevice(device) { const id = String(device.id); const next = { ...(await this.getDevice(id) || {}), ...deepClone(device), id, updated_at: nowIso() }; await this.doc("devices", id).set(next, { merge: true }); return next; }
  async getDeviceRefresh(deviceId) { const d = await this.doc("deviceRefresh", String(deviceId)).get(); return d.exists ? d.data() : null; }
  async setDeviceRefresh(deviceId, rec) { const next = { ...deepClone(rec), deviceId: String(deviceId), updated_at: nowIso() }; await this.doc("deviceRefresh", String(deviceId)).set(next, { merge: true }); return next; }
  async rotateDeviceRefresh(deviceId, expectedHash, next) {
    const dref = this.doc("devices", String(deviceId));
    const rref = this.doc("deviceRefresh", String(deviceId));
    return this.db.runTransaction(async tx => {
      const [ds, rs] = await Promise.all([tx.get(dref), tx.get(rref)]);
      const device = ds.exists ? ds.data() : null;
      const rec = rs.exists ? rs.data() : null;
      if (!device) return { ok:false, status:404, error:"device_not_found" };
      if (device.status !== "active") return { ok:false, status:403, error:"device_revoked_or_inactive" };
      if (!rec || rec.revoked) return { ok:false, status:403, error:"refresh_revoked" };
      if (rec.expiresAt && Date.now() >= Date.parse(rec.expiresAt)) return { ok:false, status:403, error:"refresh_expired" };
      if (!expectedHash || expectedHash !== rec.hash) return { ok:false, status:401, error:"invalid_refresh_token" };
      tx.set(rref, { ...deepClone(next), rotatedFrom:rec.refreshId });
      tx.set(this.doc("deviceRevoked", rec.refreshId), { deviceId, refreshId:rec.refreshId, revokedAt:nowIso(), reason:"rotated" });
      tx.update(dref, { currentRefreshId:next.refreshId, lastSeenAt:nowIso() });
      return { ok:true, device };
    });
  }
  async revokeDeviceAtomic(deviceId, by) {
    const dref = this.doc("devices", String(deviceId));
    const rref = this.doc("deviceRefresh", String(deviceId));
    return this.db.runTransaction(async tx => {
      const [ds, rs] = await Promise.all([tx.get(dref), tx.get(rref)]);
      if (!ds.exists) return null;
      const device = { ...ds.data(), status:"revoked", revokedAt:nowIso(), revokedBy:by };
      tx.set(dref, device);
      if (rs.exists) {
        const rec = rs.data();
        tx.update(rref, { revoked:true, revokedAt:nowIso() });
        if (rec.refreshId) tx.set(this.doc("deviceRevoked", rec.refreshId), { deviceId, refreshId:rec.refreshId, revokedAt:nowIso(), reason:"device_revoked" });
      }
      return device;
    });
  }
  async getDeviceRevoked(jti) { const d = await this.doc("deviceRevoked", String(jti)).get(); return d.exists ? d.data() : null; }
  async setDeviceRevoked(jti, rec) { const next = { ...deepClone(rec), jti: String(jti), updated_at: nowIso() }; await this.doc("deviceRevoked", String(jti)).set(next, { merge: true }); return next; }
}

let storeInstance = null;
function createStore(opts = {}) {
  const seed = opts.seed || null;
  const type = String(opts.type || process.env.CONTROL_GASTOS_STORE || "memory").toLowerCase();
  const prefix = opts.prefix || process.env.CONTROL_GASTOS_FIRESTORE_PREFIX || "control_gastos";
  const databaseId = opts.databaseId || process.env.CONTROL_GASTOS_FIRESTORE_DATABASE || "(default)";
  if (type === "firestore") return new FirestoreStore({ ...opts, prefix, databaseId });
  if (type === "file") return new FileStore(opts.filePath || process.env.CONTROL_GASTOS_STORE_PATH, seed);
  return new MemoryStore(seed);
}
function getStore(opts) {
  if (!storeInstance) storeInstance = createStore(opts || {});
  return storeInstance;
}
function setStore(s) { storeInstance = s; return storeInstance; }

module.exports = { MemoryStore, FileStore, FirestoreStore, createStore, getStore, setStore, nowIso, deepClone, idemKey, hashPayload, sha256 };
