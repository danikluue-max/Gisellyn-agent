// Tiny JSON-file-backed stores. Kept local on purpose:
//  - seen proof_tx values (PROOF_REUSED detection)
//  - responses by task_id (idempotency — a retried task returns the
//    stored response instead of re-proving)
// Both files live under DATA_DIR and are git-ignored (see .gitignore).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

class SeenProofTx {
  constructor(file) {
    this.file = file;
    this.set = new Set(loadJson(file, []));
  }
  has(proofTx) {
    return this.set.has(String(proofTx));
  }
  add(proofTx) {
    this.set.add(String(proofTx));
    saveJsonAtomic(this.file, [...this.set]);
  }
}

class Responses {
  constructor(file) {
    this.file = file;
    this.map = loadJson(file, {});
  }
  has(taskId) {
    return Object.prototype.hasOwnProperty.call(this.map, taskId);
  }
  get(taskId) {
    return this.map[taskId];
  }
  set(taskId, body) {
    this.map[taskId] = body;
    saveJsonAtomic(this.file, this.map);
  }
}

module.exports = { SeenProofTx, Responses };
