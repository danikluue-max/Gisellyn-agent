// Decision rules for Proof Gatekeeper tasks.
// APPROVE only if EVERY condition passes. Any doubt = REJECT (fail closed).
"use strict";

const crypto = require("node:crypto");
const { FIELD_PRIME, REGISTERED_VK_HASH } = require("./config");

const REASON = {
  VALID_CONDITION: "VALID_CONDITION",
  VK_SUBSTITUTION: "VK_SUBSTITUTION",
  PROOF_REUSED: "PROOF_REUSED",
  THRESHOLD_MISMATCH: "THRESHOLD_MISMATCH",
  EXPIRED_CONDITION: "EXPIRED_CONDITION",
  RECIPIENT_MISMATCH: "RECIPIENT_MISMATCH",
  AMOUNT_OVERFLOW: "AMOUNT_OVERFLOW",
};

// Reduce any integer (hex "0x…" or decimal string/number) mod the BN254
// field prime, returned as a decimal string for snarkjs.
function toField(value) {
  const n =
    typeof value === "string" && /^0x/i.test(value.trim())
      ? BigInt(value.trim())
      : BigInt(value);
  return (((n % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME).toString();
}

// Map the envelope task_id ("gk_24_9d1") to the circuit's numeric taskId.
// ⚠️ UNVERIFIED mapping (see README): the official example used taskId 24
// for task_id "gk_24_9d1", i.e. the number after "gk_". If the platform
// uses a different mapping, the proof will not verify on their side —
// this MUST be confirmed against a real practice task.
function parseTaskId(taskId) {
  const s = String(taskId);
  const m = /^gk_(\d+)_/i.exec(s);
  if (m) return BigInt(m[1]);
  const digits = s.match(/\d+/);
  if (digits) return BigInt(digits[0]);
  // Last-resort fallback: sha256 of the whole string, mod p.
  const h = crypto.createHash("sha256").update(s).digest("hex");
  return BigInt("0x" + h) % FIELD_PRIME;
}

// Evaluate the six on-chain conditions, in the order listed in the
// research notes. Returns { decision: 1|0, reasonCode }.
// seenProofTx is a Set of proof_tx values already used in earlier tasks.
function evaluateRules(input, seenProofTx) {
  const knownVk = REGISTERED_VK_HASH.toLowerCase();
  const registeredVk = String(input.registered_vk || "").toLowerCase();
  const proofVk = String(input.proof_vk || "").toLowerCase();

  // 1. proof_vk == registered_vk, and both == the registered vkHash.
  if (proofVk !== registeredVk || registeredVk !== knownVk) {
    return { decision: 0, reasonCode: REASON.VK_SUBSTITUTION };
  }
  // 2. public_balance >= minimum.
  if (BigInt(input.public_balance) < BigInt(input.minimum)) {
    return { decision: 0, reasonCode: REASON.THRESHOLD_MISMATCH };
  }
  // 3. recipient == condition_recipient.
  if (
    String(input.recipient || "").toLowerCase() !==
    String(input.condition_recipient || "").toLowerCase()
  ) {
    return { decision: 0, reasonCode: REASON.RECIPIENT_MISMATCH };
  }
  // 4. current_block < expiry_block (not expired).
  if (BigInt(input.current_block) >= BigInt(input.expiry_block)) {
    return { decision: 0, reasonCode: REASON.EXPIRED_CONDITION };
  }
  // 5. amount <= max_transfer.
  if (BigInt(input.amount) > BigInt(input.max_transfer)) {
    return { decision: 0, reasonCode: REASON.AMOUNT_OVERFLOW };
  }
  // 6. proof_tx (proof reference) never used before.
  if (seenProofTx.has(String(input.proof_tx))) {
    return { decision: 0, reasonCode: REASON.PROOF_REUSED };
  }
  return { decision: 1, reasonCode: REASON.VALID_CONDITION };
}

// Reason code consistent with a given decision, used only by the
// flip-on-proof-failure safety net (src/server.js). For a REJECT it
// returns the first failing condition; if none fails per our rules
// (the circuit disagreed for a reason we do not model), it falls back
// to VK_SUBSTITUTION — documented, not silently invented elsewhere.
function reasonForDecision(decision, input, seenProofTx) {
  if (decision === 1) return REASON.VALID_CONDITION;
  const r = evaluateRules(input, seenProofTx);
  if (r.decision === 0) return r.reasonCode;
  return REASON.VK_SUBSTITUTION;
}

const REQUIRED_INPUT_FIELDS = [
  "registered_vk",
  "proof_vk",
  "minimum",
  "public_balance",
  "expiry_block",
  "current_block",
  "recipient",
  "condition_recipient",
  "amount",
  "max_transfer",
  "proof_tx",
];

function missingFields(input) {
  return REQUIRED_INPUT_FIELDS.filter(
    (k) => input[k] === undefined || input[k] === null || input[k] === ""
  );
}

module.exports = {
  REASON,
  toField,
  parseTaskId,
  evaluateRules,
  reasonForDecision,
  missingFields,
};
