"use strict";

// Local-only prototype: intentionally accepts only this in-memory mock, not ADC
// or an arbitrary client. It is not wired into HTTP or the Cloud Run runtime.
// SequentialWriter (shared with the Sheets adapter) owns the write logic.
const { TEST_TARGET } = require("./durable-queue");
const { SequentialWriter, normalized } = require("./sequential-writer");

class MockSheetsClient {
  constructor(rows = []) { this.kind = "mock"; this.rows = rows.map(normalized); }
  async readAll(target) {
    if (target !== TEST_TARGET) throw new Error("target_rejected");
    return this.rows.map(row => [...row]);
  }
  async write(target, offset, rows) {
    if (target !== TEST_TARGET) throw new Error("target_rejected");
    rows.forEach((row, i) => { this.rows[offset+i] = normalized(row); });
  }
}

class MockSequentialWorker extends SequentialWriter {
  constructor(queue, sheets) {
    if (!(sheets instanceof MockSheetsClient)) throw new Error("mock_only");
    super(queue, sheets);
  }
}

module.exports = { MockSheetsClient, MockSequentialWorker };
