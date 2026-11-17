"use strict";

// Local sequential-consumer CLI. Runs the queue with a mock client only.
// Optional --file keeps the mock sheet in a JSON file so a process restart can
// be exercised. --fail-write writes then throws to simulate an ambiguous result.
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { DurableQueue } = require("../durable-queue");
const { MockSheetsClient } = require("../mock-sequential-worker");
const { SequentialWriter } = require("../sequential-writer");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? true) : fallback;
}
const file = arg("--file");
const all = process.argv.includes("--all");
const failWrite = process.argv.includes("--fail-write");
const prefix = String(arg("--prefix", process.env.CONTROL_GASTOS_LOCAL_PREFIX || "cg_e2e"));

class FileMockSheetsClient extends MockSheetsClient {
  constructor(filePath) {
    super();
    this.filePath = path.resolve(filePath);
    if (fs.existsSync(this.filePath)) {
      const payload = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.rows = (payload.rows || []).map(row => Array.from({ length:27 }, (_, i) => String(row[i] ?? "")));
    }
  }
  async write(target, offset, rows) {
    await super.write(target, offset, rows);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ rows:this.rows }, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}

class FailAfterWriteClient extends (file ? FileMockSheetsClient : MockSheetsClient) {
  async write(target, offset, rows) {
    await super.write(target, offset, rows);
    throw new Error("synthetic_timeout_after_write");
  }
}

async function main() {
  const emulator = String(process.env.FIRESTORE_EMULATOR_HOST || "");
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error("loopback emulator required");
  if (String(process.env.GCLOUD_PROJECT || "") !== "demo-control-gastos-local") throw new Error("demo project required");
  if (String(process.env.CONTROL_GASTOS_PRODUCTION_WRITE_ENABLED || "false").toLowerCase() === "true")
    throw new Error("production writes disabled");
  admin.initializeApp({ projectId: "demo-control-gastos-local" });
  const db = admin.firestore();
  const queue = new DurableQueue(db, prefix);
  const Client = failWrite ? FailAfterWriteClient : (file ? FileMockSheetsClient : MockSheetsClient);
  const sheets = file ? new Client(file) : new Client();
  const worker = new SequentialWriter(queue, sheets);
  const results = [];
  do {
    const result = await worker.runOne();
    results.push(result);
    if (!all || !result.ok && result.reason !== "empty") break;
  } while (all);
  console.log(JSON.stringify({ prefix, mode: failWrite ? "mock_fail_after_write" : "mock", rows:sheets.rows.length, results }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ ok:false, error:String(error && error.message || error) })); process.exit(1); });
