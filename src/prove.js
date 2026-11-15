// Groth16 proof generation / verification with the official circuit.
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const snarkjs = require("snarkjs");
const { FIELD_PRIME, WASM_PATH, ZKEY_PATH, VK_PATH } = require("./config");
const { toField } = require("./rules");

let vkCache = null;
function loadVk() {
  if (!vkCache) vkCache = JSON.parse(fs.readFileSync(VK_PATH, "utf8"));
  return vkCache;
}

// Fresh random salt per proof (private input; the circuit derives
// commitment = Poseidon(salt, taskId) internally).
function randomSalt() {
  const n =
    BigInt("0x" + crypto.randomBytes(32).toString("hex")) % FIELD_PRIME;
  return n === 0n ? 1n : n;
}

function buildCircuitInput(input, taskIdNum, decision, salt) {
  return {
    taskId: taskIdNum.toString(),
    minimum: BigInt(input.minimum).toString(),
    publicBalance: BigInt(input.public_balance).toString(),
    expiryBlock: BigInt(input.expiry_block).toString(),
    currentBlock: BigInt(input.current_block).toString(),
    recipient: toField(input.recipient),
    conditionRecipient: toField(input.condition_recipient),
    amount: BigInt(input.amount).toString(),
    maxTransfer: BigInt(input.max_transfer).toString(),
    registeredVkHash: toField(input.registered_vk),
    proofVkHash: toField(input.proof_vk),
    salt: BigInt(salt).toString(),
    decision: String(decision),
  };
}

async function generateProof(input, taskIdNum, decision, salt) {
  const circuitInput = buildCircuitInput(input, taskIdNum, decision, salt);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    WASM_PATH,
    ZKEY_PATH
  );
  return { proof, publicSignals };
}

async function verifyProof(publicSignals, proof) {
  return snarkjs.groth16.verify(loadVk(), publicSignals, proof);
}

module.exports = { randomSalt, buildCircuitInput, generateProof, verifyProof };
