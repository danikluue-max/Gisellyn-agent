# GISELLYN — Proof Gatekeeper agent

AI agent for **zkVerify Agent Games — Season 01** (21 Oct–21 Nov 2026),
competing in the **Proof Gatekeeper** track.

Repo: https://github.com/danikluue-max/gisellyn-agent
Participant: [danikluue-max](https://github.com/danikluue-max) · Agent name: **GISELLYN**

## What it does

The platform POSTs signed task envelopes to this endpoint. Each task is a
proof-backed payment request. The agent must, within **60 seconds**:

1. Verify the `x-agent-games-signature` HMAC on the **raw** request body.
2. Decide **APPROVE** or **REJECT** — APPROVE only if *every* condition holds:
   - `proof_vk == registered_vk` (and both equal the registered vkHash)
   - `public_balance >= minimum`
   - `recipient == condition_recipient`
   - `current_block < expiry_block`
   - `amount <= max_transfer`
   - `proof_tx` never seen before (local seen-set)
3. Prove the decision with a **Groth16** proof from the official gatekeeper
   circuit (`circuits/gatekeeper.wasm` + `gatekeeper_final.zkey`), and return
   it in the response. Fail closed: any doubt, error, or timeout = REJECT.

Anything else (bad signature → 401, malformed envelope → 400) is refused
before any work happens. A repeated `task_id` returns the stored response
instead of re-proving (idempotency).

## Run locally

```bash
npm install
cp .env.example .env   # then fill in AGENT_GAMES_SECRET
npm start              # listens on :3000 (PORT=... to change)
```

Endpoints:

| Method | Path     | Purpose |
| ------ | -------- | ------- |
| POST   | `/agent` | Signed task envelope → decision + proof |
| GET    | `/health`| Platform health check → `{status:"ok", agent:"GISELLYN"}` |
| GET    | `/`      | Agent info |

## Setting the secret

`AGENT_GAMES_SECRET` is the 32-byte hex secret the platform issues when
the agent is registered — **shown exactly once** on the dashboard. Save it
when it appears; it cannot be shown again (rotate from agent settings if
lost — the old secret dies immediately).

```bash
AGENT_GAMES_SECRET=<64 hex chars>
```

Never commit `.env` (it is git-ignored). For deployment, set the secret as
an environment variable / platform secret, never in the repo.

## Tests

```bash
npm test
```

Spawns the real server on a test port with an isolated data dir and checks:
known-good envelope (public signals byte-identical to the verified
reference in `../circuits/gk-public.json`, proof verifies with snarkjs),
all 7 trap cases with the right `reason_code`, wrong/missing HMAC → 401,
duplicate `task_id` → stored response without re-proving, malformed
input → 400, and `GET /health`.

## Response format

`src/respond.js` is the single place that builds responses:

```json
{
  "decision": "APPROVE",
  "reason_code": "VALID_CONDITION",
  "proof_tx": null,
  "proof": { "pi_a": ["…", "…", "1"], "pi_b": [["…", "…"], ["…", "…"]], "pi_c": ["…", "…", "1"] },
  "public_signals": ["45385…", "48361…", "…", "1000", "1460", "19842201", "19832000", "12688…", "12688…", "500", "1000", "1", "24"]
}
```

The raw proof + public signals are **mandatory** in every response that
has a proof (Builder Field Guide §02/§02.5: "generate proofs locally with
snarkjs, and include the proof in your response"; "Return one deterministic
decision and enough proof evidence for the platform to independently
confirm the network transaction"). `PROOF_REUSED` responses carry no
proof (there is none to submit).

`proof_tx` is the **Finalized Kurier job reference for this decision
proof** (see § "Langkah berikutnya yang wajib"). Until Kurier is
configured it is an explicit `null` placeholder — never a faked
reference, and never the input's `proof_tx` echoed (that value refers to
the *payment's* proof, not to our decision proof).

## Langkah berikutnya yang wajib (sebelum ronde live)

1. **Minta Kurier mainnet API key.** Tanpa ini tidak ada `proof_tx` yang
   valid. Alurnya (Field Guide §03): register verification key sekali →
   submit tiap decision proof dengan vk hash-nya → poll sampai job
   `Finalized` ("Safe to return as confirmed") → pakai referensi job itu
   sebagai `proof_tx` di response. Kode sudah siap menerima kuncinya:
   isi `KURIER_API_KEY` (+ `KURIER_API_URL` dari link Kurier di panduan /
   zkVerify docs — jangan tebak URL-nya) di `.env`, lalu implementasikan
   submit+poll di `src/kurier.js` (saat ini masih stub yang jujur:
   mengembalikan null bila tidak ada kunci).
2. **Uji practice task dari dashboard** (butuh endpoint HTTPS live +
   preflight lolos). Ini yang akan mengunci tiga hal yang masih
   terverifikasi di bawah: fungsi hash HMAC, pemetaan `taskId`, dan
   format preflight.
3. **Daftarkan agen** (form dashboard: nama GISELLYN, centang Proof
   Gatekeeper saja, Repository URL
   `https://github.com/danikluue-max/gisellyn-agent`, endpoint belakangan).
   Saat submit, platform menampilkan secret 32-byte **sekali** — salin
   dan simpan; itu `AGENT_GAMES_SECRET` di `.env`.
   Catatan: situs TIDAK punya menu "Connect GitHub" — "link GitHub" itu
   kolom Repository URL di form; pemenang diverifikasi manual setelah
   standings freeze, jadi kepemilikan dibuktikan lewat repo publik berisi
   kode agen ini.

## ⚠️ Yang belum terverifikasi (baca sebelum deploy)

1. **HMAC hash function.** The docs name the header
   (`x-agent-games-signature`) but never state the hash. We assume
   **HMAC-SHA256** (config: `HMAC_ALGO` in `src/config.js`, one line).
   Must be tested against the real preflight/task. The header value is
   accepted as plain hex or `sha256=<hex>`; responses are signed as plain
   hex (`HMAC_HEADER_PREFIX` to change).
2. **taskId mapping.** The circuit takes a numeric `taskId`; the official
   example (`task_id: "gk_24_9d1"`, circuit taskId `24`) implies the number
   after `gk_`. `src/rules.js:parseTaskId` implements that, with a
   digit-scan and a sha256 fallback. Must be confirmed via practice task.
3. **Preflight format.** Entry requires a signed preflight + ≥1 practice
   task (dashboard-triggered). The preflight request format is not in the
   public docs — the endpoint answers unknown POST types with 400 and
   logs them; adjust once the first preflight is observed.
4. **"Finalized before approval" vs the 60 s deadline.** The guide's
   security section says "The verification reached a finalized state
   before approval" — read literally, an APPROVE would need its proof
   submitted to Kurier and Finalized *before* answering, inside 60 s.
   Whether the platform enforces that (or accepts proof evidence in the
   response + a Finalized reference shortly after) is unknown until a
   live practice task with a real Kurier key. This is the main reason
   step 1 above is mandatory before live rounds.

## Deploy notes

- **Vercel (recommended by participants):** Node serverless function,
  ~1.3 s per proof locally — fits a 10 s hobby limit, but cold starts +
  wasm/zkey loading (~2 MB) still need a live test.
- **Cloudflare Workers/Pages:** untested for snarkjs + wasm/zkey; the
  free-plan CPU limit (10 ms) is very likely too low for proving.
- **Tailscale Funnel:** possible if the host VM stays up; fragile across
  VM replacements.
- Whichever host: HTTPS is required, the endpoint must answer within
  60 s, and the secret must come from the platform's secret store —
  never from the repo.

## Scoring (for reference)

Correct decision +12 · wrong APPROVE −6 · wrong REJECT −3 · timeout −2 ·
missing/invalid proof −2 · reliability bonus +0…+5. Rounds R01–R08,
13–20 Nov 2026, 17:30–03:30 WIB, 8 tasks/agent/round, cumulative.

## Project layout

```
index.js                 entry point (.env loader + listen)
src/
  config.js              all tournament constants + env knobs
  hmac.js                HMAC sign/verify (raw body)
  rules.js               decision rules, field conversion, taskId parse
  prove.js               snarkjs fullProve / verify
  store.js               seen proof_tx + idempotent responses (data/*.json)
  respond.js             THE response builder (change shape here)
  server.js              HTTP server: POST /agent, GET /health
circuits/                official gatekeeper circuit (wasm/zkey/vk)
test/test.js             local test suite (npm test)
data/  logs/             runtime state — local only, git-ignored
```
