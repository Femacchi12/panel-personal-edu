"use strict";

// Local sequential-consumer CLI.
// Modes:
//   (default)  MockSheetsClient in memory
//   --file     FileMockSheetsClient (persistent mock sheet)
//   --sheets   REAL Google Sheets TEST via GoogleSheetsClient + SheetsWriterClient.
//              Token: env CONTROL_GASTOS_SHEETS_TOKEN o gcloud (print-access-token).
//              Escrituras SOLO al destino TEST fijo; identidad del usuario autorizado.
//   --fail-write  writes then throws (simula resultado ambiguo; para --sheets envuelve el adaptador)
// Queue: Firestore Emulator (loopback) siempre; nunca la base productiva.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const admin = require("firebase-admin");
const { DurableQueue, TEST_TARGET } = require("../durable-queue");
const { MockSheetsClient } = require("../mock-sequential-worker");
const { SequentialWriter, WIDTH } = require("../sequential-writer");
const { GoogleSheetsClient } = require("../sheets-google-client");
const { SheetsWriterClient } = require("../sheets-writer-adapter");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? true) : fallback;
}
const file = arg("--file");
const all = process.argv.includes("--all");
const failWrite = process.argv.includes("--fail-write");
const sheets = process.argv.includes("--sheets");
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

function gcloudSheetsToken() {
  if (process.env.CONTROL_GASTOS_SHEETS_TOKEN) return process.env.CONTROL_GASTOS_SHEETS_TOKEN;
  return execSync("gcloud.cmd auth print-access-token", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

class AmbiguousSheetsWriter extends SheetsWriterClient {
  async write(target, offset, rows) {
    await super.write(target, offset, rows);
    throw new Error("synthetic_timeout_after_write_sheets");
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
  let sheets, mode;
  if (sheets) {
    const google = new GoogleSheetsClient({ getAccessToken: async () => gcloudSheetsToken() });
    sheets = new SheetsWriterClient({ sheetsClient: google, allowRealWrites: true });
    if (failWrite) sheets = new AmbiguousSheetsWriter({ sheetsClient: google, allowRealWrites: true });
    mode = failWrite ? "sheets_fail_after_write" : "sheets_real_test";
  } else {
    const Client = failWrite ? FailAfterWriteClient : (file ? FileMockSheetsClient : MockSheetsClient);
    sheets = file ? new Client(file) : new Client();
    mode = failWrite ? "mock_fail_after_write" : "mock";
  }
  const worker = new SequentialWriter(queue, sheets);
  const results = [];
  do {
    const result = await worker.runOne();
    results.push(result);
    if (!all || !result.ok && result.reason !== "empty") break;
  } while (all);
  console.log(JSON.stringify({ prefix, mode, target: sheets ? TEST_TARGET : "mock", width: WIDTH, results }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ ok:false, error:String(error && error.message || error) })); process.exit(1); });
