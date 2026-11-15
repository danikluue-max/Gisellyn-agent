// GISELLYN — Proof Gatekeeper agent endpoint (plain Node http, no framework).
// POST /agent  — signed task envelope in, decision + proof out (≤ 60 s).
// GET  /health — platform health check.
// GET  /       — tiny agent info.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  AGENT_NAME,
  TASK_TYPE,
  HMAC_ALGO,
  HMAC_HEADER,
  HMAC_HEADER_PREFIX,
  DATA_DIR,
  LOG_FILE,
} = require("./config");
const { verifyHmac, signBody } = require("./hmac");
const {
  evaluateRules,
  reasonForDecision,
  parseTaskId,
  missingFields,
} = require("./rules");
const { randomSalt, generateProof } = require("./prove");
const { SeenProofTx, Responses } = require("./store");
const { buildResponse } = require("./respond");
const { resolveProofTx } = require("./kurier");

const MAX_BODY_BYTES = 1_000_000;

// Test-only: FIXED_SALT pins the proof salt so a known-good proof can be
// reproduced byte-for-byte (test/test.js). Never set in production.
function pickSalt() {
  return process.env.FIXED_SALT ? BigInt(process.env.FIXED_SALT) : randomSalt();
}

function logEvent(event) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n"
    );
  } catch {
    // Logging must never break request handling.
  }
}

function sendJson(res, status, bodyObj, secret) {
  const raw = JSON.stringify(bodyObj);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  if (secret) {
    res.setHeader(
      HMAC_HEADER,
      signBody(secret, HMAC_ALGO, HMAC_HEADER_PREFIX, raw)
    );
  }
  res.end(raw);
}

function createServer({ secret }) {
  const seen = new SeenProofTx(path.join(DATA_DIR, "seen.json"));
  const responses = new Responses(path.join(DATA_DIR, "responses.json"));

  // Serialize /agent handling: keeps the seen-set and the idempotency
  // store consistent when tasks arrive at the same time. A proof takes
  // ~1.3 s, so even a burst of 8 tasks finishes in ~12 s — far inside
  // the 60 s deadline each task carries.
  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  // Prove a decision; if the circuit refuses it (witness assertion),
  // the circuit disagrees with our rules — flip the decision once and
  // retry. If that also fails, fall back to the decision without proof.
  async function proveWithFlip(input, taskIdNum, evald) {
    try {
      const r = await generateProof(
        input,
        taskIdNum,
        evald.decision,
        pickSalt()
      );
      return { ...evald, proof: r.proof, publicSignals: r.publicSignals };
    } catch (err) {
      const flipped = evald.decision === 1 ? 0 : 1;
      const reasonCode = reasonForDecision(flipped, input, seen.set);
      try {
        const r = await generateProof(input, taskIdNum, flipped, pickSalt());
        return {
          decision: flipped,
          reasonCode,
          proof: r.proof,
          publicSignals: r.publicSignals,
          flipped: true,
          flipError: String((err && err.message) || err),
        };
      } catch (err2) {
        return {
          ...evald,
          proof: null,
          publicSignals: null,
          proofError: String((err && err.message) || err),
        };
      }
    }
  }

  async function handleAgent(req, rawBody) {
    const started = Date.now();
    const done = (status, bodyObj, extraLog) => {
      logEvent({
        task_id: bodyObj.task_id || null,
        decision: bodyObj.decision || null,
        reason_code: bodyObj.reason_code || null,
        status,
        ms: Date.now() - started,
        ...extraLog,
      });
      return { status, bodyObj };
    };

    // 1. HMAC first, on the RAW body, before any parsing.
    const sig = req.headers[HMAC_HEADER];
    if (!verifyHmac(secret, HMAC_ALGO, rawBody, sig)) {
      return done(401, { error: "invalid signature" }, { hmac: "fail" });
    }

    // 2. Parse.
    let env;
    try {
      env = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return done(400, { error: "invalid JSON" }, {});
    }
    if (!env || env.type !== TASK_TYPE) {
      return done(400, { error: "unsupported type" }, {});
    }
    const input = env.input;
    const taskId = env.task_id;
    if (!taskId || !input || typeof input !== "object") {
      return done(400, { error: "missing task_id/input" }, {});
    }
    const missing = missingFields(input);
    if (missing.length > 0) {
      return done(
        400,
        { error: `missing input fields: ${missing.join(", ")}` },
        { task_id: taskId }
      );
    }

    // 3. Idempotency: a retried task_id returns the stored response.
    if (responses.has(taskId)) {
      const stored = responses.get(taskId);
      return done(200, stored, { task_id: taskId, duplicate: true });
    }

    // 4. Decide (fail closed).
    let evald;
    try {
      evald = evaluateRules(input, seen.set);
    } catch (e) {
      return done(
        400,
        { error: `cannot evaluate input: ${e.message}` },
        { task_id: taskId }
      );
    }

    // 5. Prove — except PROOF_REUSED, which has no proof to submit.
    let result;
    if (evald.reasonCode === "PROOF_REUSED") {
      result = { ...evald, proof: null, publicSignals: null };
    } else {
      result = await proveWithFlip(input, parseTaskId(taskId), evald);
    }

    // 6. Record the proof reference as used, resolve the decision
    // proof's Kurier reference (null until Kurier is configured —
    // see src/kurier.js), store the response, reply.
    seen.add(input.proof_tx);
    let proofTx = null;
    let kurierStatus = "skipped-no-proof";
    if (result.proof) {
      try {
        const r = await resolveProofTx({
          proof: result.proof,
          publicSignals: result.publicSignals,
        });
        proofTx = r.proofTx;
        kurierStatus = r.status;
      } catch (e) {
        // Kurier must never break the 60 s path: log and continue
        // with the null placeholder.
        kurierStatus = `error: ${e.message}`;
      }
    }
    const body = buildResponse({
      decision: result.decision,
      reasonCode: result.reasonCode,
      proofTx,
      proof: result.proof,
      publicSignals: result.publicSignals,
    });
    responses.set(taskId, body);
    return done(200, body, {
      task_id: taskId,
      proof: Boolean(result.proof),
      flipped: Boolean(result.flipped),
      proof_tx: body.proof_tx,
      kurier: kurierStatus,
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", agent: AGENT_NAME }, null);
    }
    if (req.method === "GET" && url.pathname === "/") {
      return sendJson(
        res,
        200,
        { agent: AGENT_NAME, status: "ok", tracks: ["proof-gatekeeper"] },
        null
      );
    }
    if (req.method === "POST" && url.pathname === "/agent") {
      const chunks = [];
      let size = 0;
      let tooBig = false;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) tooBig = true;
        else chunks.push(c);
      });
      req.on("end", () => {
        if (tooBig) {
          return sendJson(res, 413, { error: "body too large" }, null);
        }
        const rawBody = Buffer.concat(chunks);
        enqueue(async () => {
          const { status, bodyObj } = await handleAgent(req, rawBody);
          sendJson(res, status, bodyObj, secret);
        }).catch((e) => {
          try {
            sendJson(res, 500, { error: String((e && e.message) || e) }, null);
          } catch {
            // res already gone
          }
        });
      });
      return;
    }
    return sendJson(res, 404, { error: "not found" }, null);
  });

  return server;
}

module.exports = { createServer };
