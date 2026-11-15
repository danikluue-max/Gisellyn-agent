// GISELLYN — local test suite.
// Spawns the real server on a test port with a test secret and an
// isolated data dir, then checks every required behaviour.
// Run: npm test        (exit 0 = all pass, non-zero = something failed)
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const PORT = 3101;
const SECRET = "11".repeat(32); // 32 bytes hex, test-only
const TEST_DIR = path.join(__dirname, "tmp");
const DATA_DIR = path.join(TEST_DIR, "data");
const LOG_FILE = path.join(TEST_DIR, "tasks.log");

const VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const VFY_POLICY_VK =
  "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047";
// Full recipient address behind the research example's "0xDe42...9f01":
// its field element (from circuits/gk-public.json) is
// 1268867800305995395507099298277146472967273750273.
const RECIPIENT = "0xde42000000000000000000000000000000009f01";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function hmac(raw) {
  return crypto.createHmac("sha256", Buffer.from(SECRET, "hex")).update(raw).digest("hex");
}

function request({ method, path: p, body, rawBody, secret, headers }) {
  return new Promise((resolve, reject) => {
    const raw =
      rawBody !== undefined
        ? rawBody
        : body !== undefined
          ? JSON.stringify(body)
          : "";
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: p,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(secret !== false && raw
            ? { "x-agent-games-signature": secret || hmac(raw) }
            : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            raw: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (raw) req.write(raw);
    req.end();
  });
}

function baseInput(overrides = {}) {
  return {
    registered_vk: VK_HASH,
    proof_vk: VK_HASH,
    minimum: "1000",
    public_balance: "1460",
    expiry_block: 19842201,
    current_block: 19832000,
    recipient: RECIPIENT,
    condition_recipient: RECIPIENT,
    amount: "500",
    max_transfer: "1000",
    proof_tx: "0xa4c1" + "00".repeat(30) + "8ff1",
    ...overrides,
  };
}

function envelope(taskId, input) {
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: taskId,
    mode: "competition",
    issued_at: "2026-11-15T10:00:00Z",
    deadline_at: "2026-11-15T10:01:00Z",
    input,
  };
}

async function verifyProofOnChain(body) {
  const vk = JSON.parse(
    fs.readFileSync(path.join(ROOT, "circuits", "gatekeeper-vk.json"), "utf8")
  );
  return snarkjs.groth16.verify(vk, body.public_signals, body.proof);
}

async function waitHealth(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await request({ method: "GET", path: "/health", secret: false });
      if (r.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const server = spawn("node", ["index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_GAMES_SECRET: SECRET,
      FIXED_SALT: "987654321", // reproduce the known-good proof
      DATA_DIR,
      LOG_FILE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d));
  server.stderr.on("data", (d) => (serverOutput += d));

  try {
    check("server starts + GET /health", await waitHealth(), "");
    const h = await request({ method: "GET", path: "/health", secret: false });
    const hj = JSON.parse(h.raw);
    check(
      "GET /health body",
      hj.status === "ok" && hj.agent === "GISELLYN",
      h.raw
    );

    // (a) Known-good envelope from the official example.
    const knownGood = envelope("gk_24_9d1", baseInput());
    const t0 = Date.now();
    const r0 = await request({ method: "POST", path: "/agent", body: knownGood });
    const ms0 = Date.now() - t0;
    const b0 = JSON.parse(r0.raw);
    check("known-good: HTTP 200", r0.status === 200, `status=${r0.status}`);
    check(
      "known-good: APPROVE / VALID_CONDITION",
      b0.decision === "APPROVE" && b0.reason_code === "VALID_CONDITION",
      JSON.stringify({ decision: b0.decision, reason_code: b0.reason_code })
    );
    check(
      "known-good: response signed with HMAC header",
      r0.headers["x-agent-games-signature"] === hmac(r0.raw),
      `header=${String(r0.headers["x-agent-games-signature"]).slice(0, 16)}…`
    );
    check(
      "known-good: proof_tx is null placeholder (no Kurier yet, never echoes input)",
      b0.proof_tx === null,
      `proof_tx=${JSON.stringify(b0.proof_tx)} (input was ${knownGood.input.proof_tx})`
    );
    check(
      "known-good: proof present (805-byte class)",
      Boolean(b0.proof && b0.proof.pi_a && b0.proof.pi_b && b0.proof.pi_c),
      `proof keys=${b0.proof ? Object.keys(b0.proof).join(",") : "none"}`
    );
    const expectedSignals = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "..", "circuits", "gk-public.json"),
        "utf8"
      )
    );
    check(
      "known-good: public signals EXACTLY match the verified reference",
      JSON.stringify(b0.public_signals) === JSON.stringify(expectedSignals),
      `signals[0]=${b0.public_signals && b0.public_signals[0]}`
    );
    check(
      "known-good: snarkjs groth16 verify = true",
      await verifyProofOnChain(b0),
      `prove+verify took ${ms0} ms`
    );

    // (b) The 7 trap cases.
    const traps = [
      {
        name: "VALID_CONDITION → APPROVE",
        taskId: "gk_25_9d1",
        input: baseInput({ proof_tx: "0x" + "aa".repeat(32) }),
        decision: "APPROVE",
        reason: "VALID_CONDITION",
        expectProof: true,
      },
      {
        name: "VK_SUBSTITUTION → REJECT",
        taskId: "gk_26_9d1",
        input: baseInput({ proof_vk: VFY_POLICY_VK, proof_tx: "0x" + "bb".repeat(32) }),
        decision: "REJECT",
        reason: "VK_SUBSTITUTION",
        expectProof: true,
      },
      {
        name: "PROOF_REUSED → REJECT (no proof)",
        taskId: "gk_27_9d1",
        input: baseInput(), // same proof_tx as the known-good case
        decision: "REJECT",
        reason: "PROOF_REUSED",
        expectProof: false,
      },
      {
        name: "THRESHOLD_MISMATCH → REJECT",
        taskId: "gk_28_9d1",
        input: baseInput({ public_balance: "500", proof_tx: "0x" + "cc".repeat(32) }),
        decision: "REJECT",
        reason: "THRESHOLD_MISMATCH",
        expectProof: true,
      },
      {
        name: "EXPIRED_CONDITION → REJECT",
        taskId: "gk_29_9d1",
        input: baseInput({ current_block: 19842201, proof_tx: "0x" + "dd".repeat(32) }),
        decision: "REJECT",
        reason: "EXPIRED_CONDITION",
        expectProof: true,
      },
      {
        name: "RECIPIENT_MISMATCH → REJECT",
        taskId: "gk_30_9d1",
        input: baseInput({
          recipient: "0x0000000000000000000000000000000000000001",
          proof_tx: "0x" + "ee".repeat(32),
        }),
        decision: "REJECT",
        reason: "RECIPIENT_MISMATCH",
        expectProof: true,
      },
      {
        name: "AMOUNT_OVERFLOW → REJECT",
        taskId: "gk_31_9d1",
        input: baseInput({ amount: "1500", proof_tx: "0x" + "ff".repeat(32) }),
        decision: "REJECT",
        reason: "AMOUNT_OVERFLOW",
        expectProof: true,
      },
    ];
    for (const t of traps) {
      const r = await request({
        method: "POST",
        path: "/agent",
        body: envelope(t.taskId, t.input),
      });
      const b = JSON.parse(r.raw);
      check(
        `${t.name}: decision+reason`,
        r.status === 200 && b.decision === t.decision && b.reason_code === t.reason,
        `got ${r.status} ${b.decision}/${b.reason_code}`
      );
      if (t.expectProof) {
        check(
          `${t.name}: proof present and verifies`,
          Boolean(b.proof) && (await verifyProofOnChain(b)),
          b.proof ? "verify=true" : "no proof returned"
        );
      } else {
        check(
          `${t.name}: no proof in response`,
          !b.proof && !b.public_signals,
          `proof key present=${Boolean(b.proof)}`
        );
      }
    }

    // (c) Wrong HMAC → 401, no work done.
    const bad = await request({
      method: "POST",
      path: "/agent",
      body: envelope("gk_32_9d1", baseInput({ proof_tx: "0x" + "12".repeat(32) })),
      secret: "00".repeat(32),
    });
    check("wrong HMAC → 401", bad.status === 401, `status=${bad.status}`);

    // Missing HMAC header → 401.
    const noSig = await request({
      method: "POST",
      path: "/agent",
      body: envelope("gk_33_9d1", baseInput({ proof_tx: "0x" + "34".repeat(32) })),
      secret: false,
    });
    check("missing HMAC header → 401", noSig.status === 401, `status=${noSig.status}`);

    // (d) Duplicate task_id → stored response, no re-proving.
    const tDup0 = Date.now();
    const dup = await request({ method: "POST", path: "/agent", body: knownGood });
    const dupMs = Date.now() - tDup0;
    check(
      "duplicate task_id → identical body",
      dup.status === 200 && dup.raw === r0.raw,
      `status=${dup.status}, identical=${dup.raw === r0.raw}`
    );
    check(
      "duplicate task_id → fast (no re-proof, <500 ms)",
      dupMs < 500,
      `${dupMs} ms`
    );
    const logLines = fs
      .readFileSync(LOG_FILE, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const dupLogs = logLines.filter((l) => l.task_id === "gk_24_9d1");
    check(
      "duplicate task_id → logged as duplicate",
      dupLogs.length === 2 && dupLogs[1].duplicate === true,
      `log entries for gk_24_9d1: ${dupLogs.length}`
    );

    // Malformed inputs → 400.
    const badJson = await request({
      method: "POST",
      path: "/agent",
      rawBody: "{not json",
    });
    check("malformed JSON → 400", badJson.status === 400, `status=${badJson.status}`);
    const wrongType = await request({
      method: "POST",
      path: "/agent",
      body: { ...envelope("gk_34_9d1", baseInput()), type: "something.else.v1" },
    });
    check("wrong type → 400", wrongType.status === 400, `status=${wrongType.status}`);
    const missingField = await request({
      method: "POST",
      path: "/agent",
      body: envelope(
        "gk_35_9d1",
        baseInput({ proof_tx: "0x" + "56".repeat(32), amount: undefined })
      ),
    });
    check(
      "missing input field → 400",
      missingField.status === 400,
      `status=${missingField.status}`
    );

    // Log file sanity (re-read fresh — the earlier read was stale).
    const finalLogLines = fs
      .readFileSync(LOG_FILE, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    check(
      "tasks.log has one line per handled task",
      finalLogLines.length === 14,
      `${finalLogLines.length} lines (8 tasks + 2×401 + 1 duplicate + 3×400)`
    );
    const sample = finalLogLines.find((l) => l.task_id === "gk_24_9d1");
    check(
      "log line shape (task_id/decision/reason_code/ms)",
      Boolean(
        sample &&
          "decision" in sample &&
          "reason_code" in sample &&
          typeof sample.ms === "number"
      ),
      JSON.stringify(sample)
    );
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (serverOutput.trim()) {
      console.log("\n--- server output ---\n" + serverOutput.trim());
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
    process.exit(1);
  }
  // Explicit exit: snarkjs leaves worker handles behind that keep the
  // event loop alive after main() returns (observed in run 1).
  process.exit(0);
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
