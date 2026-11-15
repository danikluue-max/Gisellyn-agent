// Response shape — THE single place that builds what we send back.
// Change it here and it changes everywhere (health check excluded).
//
// Per the Builder Field Guide (/build §02, §02.5 — verified 15 Nov 2026):
//   "Return one deterministic decision and enough proof evidence for the
//    platform to independently confirm the network transaction."
//   "generate proofs locally with snarkjs, and include the proof in your
//    response."
// So the raw Groth16 proof + public signals are MANDATORY in every
// response that has a proof. There is no option to omit them.
//
// proof_tx: the Finalized Kurier job reference for THIS decision proof
// (see src/kurier.js). Until Kurier is configured it is an explicit
// null — a clear placeholder, never a faked reference, and never the
// input's proof_tx echoed (that value refers to the *payment's* proof,
// not to our decision proof). PROOF_REUSED responses also carry null
// (there is no proof to submit).
"use strict";

function buildResponse({ decision, reasonCode, proofTx, proof, publicSignals }) {
  const body = {
    decision: decision === 1 ? "APPROVE" : "REJECT",
    reason_code: reasonCode,
    proof_tx: proofTx === undefined || proofTx === null ? null : proofTx,
  };
  if (proof && publicSignals) {
    body.proof = proof; // snarkjs { pi_a, pi_b, pi_c, protocol, curve }
    body.public_signals = publicSignals; // 13 decimal strings, fixed order
  }
  return body;
}

module.exports = { buildResponse };
