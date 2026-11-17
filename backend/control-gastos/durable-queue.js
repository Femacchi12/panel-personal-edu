"use strict";

// Experimental queue foundation. It deliberately has no Sheets write path.
// A claimed item never expires or transfers to another worker automatically.
const crypto = require("crypto");
const { MOVIMIENTOS_COLUMNS } = require("./validation");
const TEST_TARGET = Object.freeze({ spreadsheetId:"1nB7Qc8hBnipTemceTEQeNZqteRhRULAZJwM9Js01GUY", sheet:"Movimientos_Test" });
const digest = x => crypto.createHash("sha256").update(String(x)).digest("hex");
const timestamp = () => new Date().toISOString();
const STATUS = Object.freeze(Object.fromEntries([
  "PENDING", "PROCESSING", "COMMITTED", "ALREADY_REGISTERED",
  "NEEDS_INFORMATION", "UNCERTAIN", "MANUAL_REVIEW", "CONFIRMED_FAILED"
].map(s => [s, s])));
const TRANSITIONS = Object.freeze({
  PENDING:[STATUS.PROCESSING],
  PROCESSING:[STATUS.COMMITTED, STATUS.ALREADY_REGISTERED, STATUS.NEEDS_INFORMATION, STATUS.UNCERTAIN, STATUS.MANUAL_REVIEW, STATUS.CONFIRMED_FAILED],
  UNCERTAIN:[STATUS.MANUAL_REVIEW],
  MANUAL_REVIEW:[STATUS.MANUAL_REVIEW]
});
function assertTransition(from, to) {
  if (!(TRANSITIONS[from] || []).includes(to)) throw new Error("invalid_status_transition");
}

class DurableQueue {
  constructor(db, prefix = "control_gastos") {
    this.db = db;
    this.root = db.collection(`${prefix}_writeDestinations`).doc(digest(`${TEST_TARGET.spreadsheetId}:${TEST_TARGET.sheet}`));
    this.ops = this.root.collection("operations");
    this.keys = this.root.collection("operationKeys");
    this.origins = this.root.collection("origins");
  }

  async enqueue(input) {
    const correction = input && input.type === "correction";
    const rows = Array.isArray(input?.rows) ? input.rows : [];
    const patch = input?.patch && typeof input.patch === "object" && !Array.isArray(input.patch) ? input.patch : null;
    const validRows = rows.length > 0 && rows.every(row => Array.isArray(row) && row.length === MOVIMIENTOS_COLUMNS.length);
    if (!input || input.confirmed !== true || !input.operationKey || !input.filaOrigen ||
        !["insert", "correction", "split"].includes(input.type)) {
      throw new Error("invalid_confirmed_operation");
    }
    if (correction) {
      // A correction is either a full expected row (legacy/local) or a patch
      // applied by the single writer to the row it reads. Never both absent.
      const hasPatch = !!patch && Object.keys(patch).length > 0 && typeof input.movId === "string" && input.movId.trim();
      if (!validRows && !hasPatch) throw new Error("invalid_confirmed_operation");
      if (validRows && rows.length !== 1) throw new Error("invalid_row_count");
      if (!Number.isInteger(input.rowNum) || input.rowNum < 2) throw new Error("invalid_confirmed_operation");
      if (input.before != null && (!Array.isArray(input.before) || input.before.length !== MOVIMIENTOS_COLUMNS.length))
        throw new Error("invalid_confirmed_operation");
    } else {
      if (!validRows || rows.length === 0) throw new Error("invalid_confirmed_operation");
      if (input.type !== "split" && rows.length !== 1) throw new Error("invalid_row_count");
    }
    const key = this.keys.doc(digest(input.operationKey));
    const origin = correction ? null : this.origins.doc(digest(input.filaOrigen));
    // Firestore does not permit arrays directly nested in arrays.
    const payload = { type:input.type, filaOrigen:String(input.filaOrigen), rows:rows.map(cells => ({ cells })),
      rowNum:input.rowNum ?? null, before:input.before ?? null, patch, movId:correction ? String(input.movId || "") : null,
      confirmed:true };
    const payloadHash = digest(JSON.stringify(payload));
    const op = this.ops.doc();
    return this.db.runTransaction(async tx => {
      const [ks, ds, os] = await Promise.all([tx.get(key), tx.get(this.root), origin ? tx.get(origin) : Promise.resolve(null)]);
      if (ks.exists) {
        const existing = ks.data();
        if (existing.payloadHash !== payloadHash) throw new Error("idempotency_conflict");
        return { id:existing.id, sequence:existing.sequence, duplicate:true };
      }
      if (os && os.exists) {
        return { id:os.data().id, sequence:os.data().sequence, duplicate:true, reason:"fila_origen_exists" };
      }
      const state = ds.exists ? ds.data() : {};
      const sequence = (state.lastSequence || 0) + 1;
      const data = { id:op.id, operationKey:String(input.operationKey), target:TEST_TARGET,
        ...payload, payloadHash, sequence, status:STATUS.PENDING, createdAt:timestamp(),
        auditRef:`operation:${op.id}`, reconciliation:null,
        audit:[{ event:"confirmed_and_enqueued", at:timestamp() }] };
      tx.set(op, data);
      tx.set(key, { id:op.id, sequence, payloadHash });
      if (origin) tx.set(origin, { id:op.id, sequence, filaOrigen:String(input.filaOrigen) });
      tx.set(this.root, { lastSequence:sequence, nextSequence:state.nextSequence || 1,
        active:state.active || null, blocked:state.blocked || false }, { merge:true });
      return { id:op.id, sequence, duplicate:false };
    });
  }

  async claim() {
    return this.db.runTransaction(async tx => {
      const ds = await tx.get(this.root);
      if (!ds.exists) return { ok:false, reason:"empty" };
      const state = ds.data();
      // Never steal, even after arbitrarily long delays or process termination.
      if (state.active || state.blocked) return { ok:false, reason:"manual_review_required" };
      const q = await tx.get(this.ops.where("sequence", "==", state.nextSequence || 1).limit(1));
      if (q.empty) return { ok:false, reason:"empty" };
      const doc = q.docs[0], item = doc.data();
      if (item.status !== STATUS.PENDING) return { ok:false, reason:"unexpected_state" };
      assertTransition(item.status, STATUS.PROCESSING);
      const claimId = crypto.randomUUID();
      tx.update(this.root, { active:{ operationId:doc.id, claimId, claimedAt:timestamp() }, blocked:true });
      tx.update(doc.ref, { status:STATUS.PROCESSING, claimId, claimedAt:timestamp(),
        audit:[...(item.audit || []), { event:"claimed", at:timestamp() }] });
      return { ok:true, operation:item, claimId };
    });
  }

  async getOperation(id) {
    const doc = await this.ops.doc(String(id)).get();
    return doc.exists ? doc.data() : null;
  }

  // Read-only view of the single destination lock/block state for status UIs.
  async getDestinationState() {
    const doc = await this.root.get();
    if (!doc.exists) return null;
    const d = doc.data();
    return { blocked: !!d.blocked, active: d.active || null, nextSequence: d.nextSequence || 1,
      lastSequence: d.lastSequence || 0, lastReservedId: d.lastReservedId || 0 };
  }

  // Lease de exclusividad del consumidor: una sola ejecucion del escritor por
  // destino a la vez (transaccional, vale para multiples instancias).
  // El lease vence solo (ttlMs) y la liberacion es condicional al holder.
  async acquireConsumerLease(holder, ttlMs = 120000) {
    const now = Date.now();
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.root);
      const d = doc.exists ? doc.data() || {} : {};
      const lease = d.consumerLease || null;
      if (lease && lease.expiresAt && now < Number(new Date(lease.expiresAt).getTime())) {
        if (lease.holder === holder) return { ok: true, reacquired: true };
        return { ok: false, reason: "consumer_busy", holder: lease.holder, expiresAt: lease.expiresAt };
      }
      const next = { holder, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
      tx.set(this.root, { consumerLease: next }, { merge: true });
      return { ok: true, lease: next };
    });
  }

  async releaseConsumerLease(holder) {
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.root);
      const d = doc.exists ? doc.data() || {} : {};
      const lease = d.consumerLease || null;
      if (!lease || lease.holder !== holder) return { ok: false, reason: "not_holder" };
      tx.set(this.root, { consumerLease: null }, { merge: true });
      return { ok: true };
    });
  }

  async prepare(id, claimId, observedMax, count, intent) {
    if (!Number.isSafeInteger(observedMax) || observedMax < 0 || !Number.isSafeInteger(count) || count < 0 || count > 100)
      throw new Error("invalid_reservation");
    if (!intent || !Array.isArray(intent.rows) || !Number.isSafeInteger(intent.offset) ||
        intent.rows.some(r => !Array.isArray(r) || r.length !== MOVIMIENTOS_COLUMNS.length))
      throw new Error("invalid_intent");
    const ref = this.ops.doc(String(id));
    return this.db.runTransaction(async tx => {
      const [root, op] = await Promise.all([tx.get(this.root), tx.get(ref)]);
      const state = root.exists && root.data(), item = op.exists && op.data();
      if (!state || !item || !state.active || state.active.operationId !== id || state.active.claimId !== claimId || item.status !== STATUS.PROCESSING)
        throw new Error("stale_claim");
      if (item.writeIntentAt) throw new Error("write_intent_already_recorded");
      const base = Math.max(state.lastReservedId || 0, observedMax);
      const ids = Array.from({length:count}, (_, i) => `MOV-${String(base + i + 1).padStart(5, "0")}`);
      const intendedRows = intent.rows.map((row, i) => {
        const cells = [...row];
        if (count) cells[0] = ids[i];
        return { cells };
      });
      const at = timestamp();
      tx.update(this.root, { lastReservedId:base + count });
      tx.update(ref, { reservedIds:ids, writeIntentAt:at, intent:{offset:intent.offset, rows:intendedRows, backup:intent.backup || null},
        audit:[...(item.audit || []), { event:"write_intent", at }] });
      return ids;
    });
  }

  async finish(id, claimId, status, result) {
    if (!["COMMITTED", "ALREADY_REGISTERED", "NEEDS_INFORMATION", "CONFIRMED_FAILED", "UNCERTAIN"].includes(status))
      throw new Error("invalid_status");
    const ref = this.ops.doc(String(id));
    return this.db.runTransaction(async tx => {
      const [root, op] = await Promise.all([tx.get(this.root), tx.get(ref)]);
      const state = root.exists && root.data(), item = op.exists && op.data();
      if (!state || !item || !state.active || state.active.operationId !== id || state.active.claimId !== claimId || item.status !== STATUS.PROCESSING)
        throw new Error("stale_claim");
      assertTransition(item.status, status);
      const at = timestamp();
      tx.update(ref, { status, result, completedAt:at, audit:[...(item.audit || []), { event:status, at }] });
      if (status === "UNCERTAIN") tx.update(this.root, { blocked:true });
      else tx.update(this.root, { blocked:false, active:null, nextSequence:item.sequence + 1 });
      return { id, status, result };
    });
  }

  async markUncertain(id, claimId, evidence) {
    if (!evidence || typeof evidence !== "string" || !evidence.trim()) throw new Error("evidence_required");
    const ref = this.ops.doc(String(id));
    return this.db.runTransaction(async tx => {
      const [root, op] = await Promise.all([tx.get(this.root), tx.get(ref)]);
      const active = root.exists && root.data().active;
      if (!op.exists || !active || active.operationId !== id || active.claimId !== claimId ||
          op.data().status !== STATUS.PROCESSING) throw new Error("stale_claim");
      assertTransition(op.data().status, STATUS.MANUAL_REVIEW);
      const at = timestamp();
      tx.update(ref, { status:STATUS.MANUAL_REVIEW, reconciliation:{ evidence, at },
        audit:[...(op.data().audit || []), { event:"manual_review_required", at }] });
      tx.update(this.root, { blocked:true });
      return { id, status:STATUS.MANUAL_REVIEW };
    });
  }

  async recordManualReview(id, evidence, reviewer) {
    if (typeof evidence !== "string" || !evidence.trim() || typeof reviewer !== "string" || !reviewer.trim())
      throw new Error("evidence_and_reviewer_required");
    const ref = this.ops.doc(String(id));
    return this.db.runTransaction(async tx => {
      const [root, op] = await Promise.all([tx.get(this.root), tx.get(ref)]);
      const active = root.exists && root.data().active;
      if (!op.exists || !active || active.operationId !== id || !["UNCERTAIN","MANUAL_REVIEW"].includes(op.data().status))
        throw new Error("not_uncertain");
      assertTransition(op.data().status, STATUS.MANUAL_REVIEW);
      const at = timestamp(), item = op.data();
      tx.update(ref, { status:"MANUAL_REVIEW", reconciliation:{evidence, reviewer, at},
        audit:[...(item.audit || []), {event:"manual_review", reviewer, at}] });
      return { id, status:"MANUAL_REVIEW", destinationBlocked:true };
    });
  }
}
module.exports = { DurableQueue, TEST_TARGET, STATUS, assertTransition };
