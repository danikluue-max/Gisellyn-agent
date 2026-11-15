// Kurier (zkVerify proof submission) — READY FOR THE API KEY, NOT LIVE YET.
//
// Documented flow (Builder Field Guide /build §03, verified 15 Nov 2026):
//   1. Get a mainnet API key.
//   2. Register the verification key ONCE (submit proof with its vk hash).
//   3. Submit each decision proof.
//   4. Poll until the job reaches Finalized ("Safe to return as confirmed").
//   5. The Finalized job reference is the response's proof_tx.
// Job states: Submitted → IncludedInBlock → Finalized.
//
// Current state: NO mainnet API key exists, so NO submission is attempted
// and resolveProofTx() returns null. The response proof_tx is therefore an
// explicit null placeholder (see src/respond.js) — never a faked reference,
// and never the input's proof_tx echoed (that value refers to the
// *payment's* proof, not to our decision proof).
// The code is wired so that adding the key (+ the real Kurier base URL,
// taken from the guide's Kurier link / zkVerify docs — do NOT guess it)
// is all that is needed to start the submission work below.
"use strict";

const { KURIER_API_KEY, KURIER_API_URL } = require("./config");

// Returns { proofTx, status }.
//  - not-configured: no KURIER_API_KEY in env (normal today).
//  - no-api-url: key present but KURIER_API_URL empty — cannot submit.
//  - throws: key + URL present but the submit+poll flow has not been
//    implemented/tested against mainnet yet. The caller catches this and
//    falls back to proofTx null; it must never break the 60 s path.
async function resolveProofTx({ proof, publicSignals }) {
  void proof;
  void publicSignals;
  if (!KURIER_API_KEY) {
    return { proofTx: null, status: "not-configured" };
  }
  if (!KURIER_API_URL) {
    return { proofTx: null, status: "no-api-url" };
  }
  throw new Error(
    "Kurier submission not implemented yet: key and URL are configured, " +
      "but register-vk-once + submit + poll-until-Finalized still needs " +
      "a live mainnet test. See README 'Langkah berikutnya yang wajib'."
  );
}

module.exports = { resolveProofTx };
