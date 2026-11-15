// GISELLYN — Proof Gatekeeper agent. Entry point.
// Loads .env (if present), then listens on PORT (default 3000).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("./src/server");
const { AGENT_NAME } = require("./src/config");

function loadDotEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const secret = process.env.AGENT_GAMES_SECRET || "";

if (!secret) {
  console.warn(
    "[GISELLYN] WARNING: AGENT_GAMES_SECRET is not set — every POST /agent " +
      "will answer 401 until the platform secret is configured. " +
      "See .env.example. /health still answers."
  );
} else if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
  console.warn(
    "[GISELLYN] WARNING: AGENT_GAMES_SECRET does not look like 32 bytes " +
      "of hex (64 hex chars). HMAC verification will likely fail."
  );
}

const server = createServer({ secret });
server.listen(PORT, () => {
  console.log(`[GISELLYN] Proof Gatekeeper agent listening on :${PORT}`);
  console.log(`[GISELLYN] POST /agent (signed) · GET /health`);
});
