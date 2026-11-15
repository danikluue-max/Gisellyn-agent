// HMAC signing / verification for task envelopes and responses.
// The header is checked against the RAW body, BEFORE any JSON parsing.
"use strict";

const crypto = require("node:crypto");

function hmacHex(secretHex, algo, rawBody) {
  const key = Buffer.from(secretHex, "hex");
  return crypto.createHmac(algo, key).update(rawBody).digest("hex");
}

// Accept "sha256=<hex>" or plain "<hex>" on the way in.
function stripPrefix(sig) {
  const s = String(sig || "").trim();
  const m = /^sha256=/i.exec(s);
  return m ? s.slice(m[0].length) : s;
}

function verifyHmac(secretHex, algo, rawBody, headerValue) {
  if (!secretHex || !headerValue) return false;
  const expected = hmacHex(secretHex, algo, rawBody);
  const got = stripPrefix(headerValue);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signBody(secretHex, algo, prefix, rawBody) {
  return `${prefix}${hmacHex(secretHex, algo, rawBody)}`;
}

module.exports = { hmacHex, stripPrefix, verifyHmac, signBody };
