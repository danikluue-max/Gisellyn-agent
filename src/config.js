// GISELLYN — Proof Gatekeeper agent config.
// Every tournament constant lives here, in one place.
"use strict";

const path = require("node:path");

// Registered gatekeeper verification-key hash, from the platform's
// /api/circuit-info (verified live 15 Nov 2026).
const REGISTERED_VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";

// BN254 field prime (snarkjs reduces 256-bit values mod p).
const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const AGENT_NAME = "GISELLYN";
const TASK_TYPE = "agent-games.proof-gatekeeper.v1";

// HMAC settings.
// ⚠️ UNVERIFIED (see README § "Yang belum terverifikasi"):
// the platform docs name the header but never state the hash function.
// HMAC-SHA256 is the common assumption. If the real preflight/task
// disagrees, change ONE line here (HMAC_ALGO) and re-test.
const HMAC_ALGO = process.env.HMAC_ALGO || "sha256";
const HMAC_HEADER = "x-agent-games-signature";
// The platform signs task envelopes; we sign our responses the same way.
const HMAC_HEADER_PREFIX = process.env.HMAC_HEADER_PREFIX || ""; // e.g. "sha256="

// Response shape — see src/respond.js. Per the Builder Field Guide
// (verified 15 Nov 2026, /build §02.5): "generate proofs locally with
// snarkjs, and include the proof in your response" — the raw proof is
// MANDATORY, not optional. There is no toggle to omit it.
//
// Kurier (zkVerify submission) — see src/kurier.js. KURIER_API_KEY is
// accepted from env now; the submission flow itself is NOT live yet
// (no mainnet key exists). Until it is, response proof_tx is null.
const KURIER_API_KEY = process.env.KURIER_API_KEY || "";
// Base URL of the Kurier REST API — fill from the build guide's Kurier
// link / zkVerify docs when the key is requested. Do NOT guess it.
const KURIER_API_URL = process.env.KURIER_API_URL || "";

const WASM_PATH = path.join(__dirname, "..", "circuits", "gatekeeper.wasm");
const ZKEY_PATH = path.join(
  __dirname,
  "..",
  "circuits",
  "gatekeeper_final.zkey"
);
const VK_PATH = path.join(__dirname, "..", "circuits", "gatekeeper-vk.json");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const LOG_FILE =
  process.env.LOG_FILE || path.join(__dirname, "..", "logs", "tasks.log");

module.exports = {
  REGISTERED_VK_HASH,
  FIELD_PRIME,
  AGENT_NAME,
  TASK_TYPE,
  HMAC_ALGO,
  HMAC_HEADER,
  HMAC_HEADER_PREFIX,
  WASM_PATH,
  ZKEY_PATH,
  VK_PATH,
  DATA_DIR,
  LOG_FILE,
  KURIER_API_KEY,
  KURIER_API_URL,
};
