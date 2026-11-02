// Deterministic steps of the material workflow, one command per step group, so
// each costs the agent a single tool call instead of 3-6 (every tool call is a
// full ~10s LLM round trip). The agent keeps the judgement calls — classifying
// negotiation replies, choosing counter values — and these commands do the
// deterministic steps: session key, locks, round counter, traces, negotiation-wait
// registration, run context, and spawning the Order/Planning subagents.
//
// Run context lives in /tmp/mat_ctx_<uuid>.json (written by `rate` from the
// material_engine job result), so later turns read ids from it instead of
// recovering them from session history.
//
// Usage: sh mat.sh <command> [args]   — every command prints one JSON line.
//   start 'TASK_JSON'         Case B: processing lock + engineStarted trace + submits the
//                             material_engine re-plan (rates inline if it finishes in ~6s)
//   submitted JOB_ID BIZ_ID   legacy: bind a model-submitted job + engineSubmitted trace
//   rate JOB_ID               Case E: assessment (Mode B, by job id) + Step 1.6 bookkeeping
//   reply ACTION [DELAY QTY]  Case C: guards + traces for keep|abandon|counter|ambiguous;
//                             counter submits the re-plan like start
//   order                     Step 2: close wait + traces; spawns the Order Agent (idempotent)
//   planning [ORDER_JSON]     Step 3: traces; spawns the Planning Agent (idempotent)
//   finish                    Step 4: terminal trace + close wait + cleanup (refuses while a
//                             started handoff has no spawned child)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const BIN = "/home/node/.openclaw/agents/material/bin";
const ALLOCATOR = "http://allocator-backend:8000";
const BACKEND = process.env.BACKEND_URL || "http://auth-service:4000";
const MCP = "http://mcp-server:9500";
const MAX_NEGOTIATION_ROUNDS = 5;
// How long submitEngine waits for a cache hit (done in 1-3s) before binding. Keep the
// whole command under exec's ~10s yield, or it gets backgrounded mid-step.
const FAST_PATH_SECS = 6;

const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const fail = (msg) => { console.log(JSON.stringify({ error: msg })); process.exit(1); };

// MAT_SESSION_UUID: test override, so the commands can be exercised outside an agent turn.
const uuid = process.env.MAT_SESSION_UUID || execFileSync("sh", [`${BIN}/session_key.sh`], { encoding: "utf8" }).trim();
if (!uuid) fail("could not resolve this session's key (session_key.sh returned nothing)");
const sessionKey = `agent:material:subagent:${uuid}`;

const f = {
  lock: `/tmp/mat_lock_${uuid}`,
  ctx: `/tmp/mat_ctx_${uuid}.json`,
  round: `/tmp/mat_neg_${uuid}_round`,
  orderSpawned: `/tmp/mat_order_spawned_${uuid}`,
  planning: `/tmp/mat_planning_${uuid}`,
  processed: (n) => `/tmp/mat_neg_${uuid}_round_${n}_processed`,
};
const readCtx = () => { try { return JSON.parse(fs.readFileSync(f.ctx, "utf8")); } catch { return null; } };
const writeCtx = (c) => fs.writeFileSync(f.ctx, JSON.stringify(c));
const touch = (p) => fs.writeFileSync(p, "");

async function trace(step, level, businessId, extra = {}) {
  // sessionKey lets switch-service attribute the trace to the chat thread that owns this run.
  const value = { step: `trace.material.${step}`, agent: "material", level, businessId, sessionKey, ...extra };
  // node:http, not fetch: switch-service listens on 6000, a fetch-spec "bad port"
  // (X11) that undici refuses outright — every trace was silently dropped.
  const body = JSON.stringify({
    sender: "-1",
    content: JSON.stringify({ type: "CustomEvent", name: "schub/trace", value }),
    recipients: ["-2"],
  });
  await new Promise((resolve) => {
    const req = http.request(
      { host: "switch-service", port: 6000, path: "/publish", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 5000 },
      (res) => { res.resume(); res.on("end", resolve); },
    );
    // traces are best-effort UI progress; never fail a step on them
    req.on("error", resolve);
    req.on("timeout", () => { req.destroy(); resolve(); });
    req.end(body);
  });
}

async function resolveWait(caseId) {
  if (caseId == null) return;
  await fetch(`${ALLOCATOR}/cases/${caseId}/negotiation-waits/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, action: "agent_resolved" }),
  }).catch(() => {});
}

// Spawns a subagent as this session through the gateway (POST /tools/invoke, which applies
// this session's tool policy). Done here, not by the model: the model once printed
// "Delegated to Order Agent" without making the call and the run hung. A child spawned
// over HTTP inherits the HTTP hard-deny list, so gateway.tools.allow must list both
// sessions_spawn and exec — without exec the Order Agent can't run ord.sh.
async function spawnAgent(agentId, task) {
  const r = await fetch("http://openclaw:18789/tools/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENCLAW_TOKEN}` },
    body: JSON.stringify({ name: "sessions_spawn", sessionKey, args: { agentId, task, mode: "run" } }),
  }).catch((e) => fail(`sessions_spawn ${agentId} failed: ${e}`));
  const body = await r.json().catch(() => ({}));
  const d = body?.result?.details ?? {};
  const child = d.childSessionKey ?? d.sessionKey;
  if (!body.ok || !child) fail(`sessions_spawn ${agentId} failed: HTTP ${r.status} ${JSON.stringify(body).slice(0, 500)}`);
  return child;
}

// Idempotency for the spawn steps: a child spawned by this session shows up in that
// agent's sessions.json, and its key is recorded in the step's marker once seen, so a
// retried step never spawns a second child.
function childOf(agentId) {
  try {
    const idx = JSON.parse(fs.readFileSync(`/home/node/.openclaw/agents/${agentId}/sessions/sessions.json`, "utf8"));
    return Object.entries(idx).find(([, v]) => v.spawnedBy === sessionKey)?.[0] ?? null;
  } catch { return null; }
}

// The confirmed child's key for [marker], recording it on first sight; null if not spawned yet.
function confirmedChild(agentId, marker) {
  const recorded = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (recorded) return recorded;
  const child = childOf(agentId);
  if (child) fs.writeFileSync(marker, child);
  return child;
}

const waitingFields = (c) => ({
  caseId: c.case_id, sessionKey, round: c.round, rating: c.rating, explanation: c.explanation,
  supplyId: c.supply_id, currentDelay: c.delivery_delay_days, currentQtyPct: c.quantity_decrease_pct,
  baselinePlanRunId: c.plan_run_id, contingentPlanRunId: c.contingent_plan_run_id,
  impactedDemandCount: c.impacted_demand_count,
});

const spawnTask = (c, type, extra) => JSON.stringify({
  business_id: c.business_id, message_id: c.message_id, type, original_type: "Material",
  source: c.source, recipients: c.recipients, supply_id: c.supply_id,
  delivery_delay_days: c.delivery_delay_days, quantity_decrease_pct: c.quantity_decrease_pct,
  case_id: c.case_id, plan_run_id: c.plan_run_id, ...extra,
});

const [cmd, ...args] = process.argv.slice(2);

// Submits a material_engine re-plan with this session's real key. Done here, not by the
// model: OpenClaw redacts session keys in stored transcripts, so on a counter turn the
// model copied `agent:…d097` into the engine call and the completion went nowhere.
// Cache hits and result reuse finish in ~1s, so poll briefly and rate inline — a
// completion callback landing while this turn is still running can be dropped. Only a
// real re-plan binds the session and waits for the callback (Case E).
async function submitEngine(c, params, doneMarker) {
  const r = await fetch(`${MCP}/jobs/material`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, event_type: "Material", agent_id: "material" }),
  }).catch((e) => fail(`material_engine submit failed: ${e}`));
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.job_id) fail(`material_engine submit failed: HTTP ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  const job = body.job_id;
  if (doneMarker) touch(doneMarker); // only once submitted, so a failed submit can be retried
  await trace("engineSubmitted", "waiting", params.business_id, { jobId: job, ...(c?.round ? { round: c.round } : {}) });

  for (let i = 0; i < FAST_PATH_SECS; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const s = await fetch(`${BACKEND}/async-jobs/${job}`).then((x) => x.json()).catch(() => ({}));
    if (s.status === "completed" || s.status === "error") {
      args.splice(0, args.length, job);
      return commands.rate();
    }
  }
  // Resumes at once if the job finished since the last poll.
  const br = await fetch(`${MCP}/jobs/${job}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_key: sessionKey, agent_id: "material" }),
  }).catch((e) => ({ ok: false, status: String(e) }));
  if (!br.ok) fail(`could not bind job ${job} to ${sessionKey}: ${br.status}`);
  out({ next: "wait", job_id: job });
}

const commands = {
  async start() {
    const [arg] = args;
    // Legacy form `start BUSINESS_ID` only takes the lock; `start 'TASK_JSON'` also
    // submits the initial re-plan.
    let task = null;
    if (String(arg ?? "").trim().startsWith("{")) {
      try { task = JSON.parse(arg); } catch { fail("task is not valid JSON"); }
      if (task.business_id == null || !task.supply_id) fail("task needs business_id and supply_id");
    }
    const biz = Number(task ? task.business_id : arg);
    if (fs.existsSync(f.lock)) out({ duplicate: true });
    touch(f.lock);
    await trace("engineStarted", "major", biz);
    if (!task) out({ session_uuid: uuid, session_key: sessionKey });
    await submitEngine(null, {
      business_id: biz, supply_id: task.supply_id,
      delivery_delay_days: Number(task.delivery_delay_days ?? 0),
      quantity_decrease_pct: Number(task.quantity_decrease_pct ?? 0),
      source: task.source ?? 1, recipients: task.recipients ?? [], message_id: task.message_id ?? null,
    });
  },

  async submitted() {
    const [job, biz] = args;
    const c = readCtx();
    // Bind the job's completion to this session's real key. The agent's own
    // `session_key` engine arg can't be trusted: OpenClaw redacts session keys in
    // stored transcripts, and a repeat engine call copies the redacted value.
    const br = await fetch(`http://mcp-server:9500/jobs/${job}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_key: sessionKey, agent_id: "material" }),
    }).catch((e) => ({ ok: false, status: String(e) }));
    if (!br.ok) fail(`could not bind job ${job} to ${sessionKey}: ${br.status}`);
    await trace("engineSubmitted", "waiting", Number(biz ?? c?.business_id), { jobId: job, ...(c?.round ? { round: c.round } : {}) });
    out({ ok: true });
  },

  async rate() {
    const [job] = args;
    const jr = await fetch(`${BACKEND}/async-jobs/${job}`);
    if (!jr.ok) fail(`job ${job}: HTTP ${jr.status}`);
    const r = (await jr.json()).result || {};
    const m = r.material_impact;
    if (!m) fail(`job ${job} has no material_impact`);
    // The engine reports failures (timeout, allocator error) inside material_impact;
    // surface that instead of posting it to the assessment as if it were an impact.
    if (m.error) {
      await trace("assessmentFailed", "major", r.business_id, { params: { error: m.error } });
      out({ next: "error", error: `material re-plan failed: ${m.error}`, business_id: r.business_id });
    }

    const prev = readCtx() || {};
    const c = {
      ...prev,
      business_id: r.business_id, message_id: r.message_id ?? null, source: r.source,
      recipients: r.recipients, supply_id: r.supply_id,
      delivery_delay_days: m.deliveryDelayDays, quantity_decrease_pct: m.quantityDecreasePct,
      case_id: m.caseId, plan_run_id: m.planRunId, contingent_plan_run_id: m.contingentPlanRunId,
      impacted_demand_count: m.impactedDemandCount,
    };

    // Mode B: forward material_impact verbatim (Mode A's pegging approximation under-counts).
    const ar = await fetch(`${ALLOCATOR}/material-impact-assessment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: m.caseId, supplyId: r.supply_id, planRunId: m.planRunId,
        deliveryDelayDays: m.deliveryDelayDays, quantityDecreasePct: m.quantityDecreasePct, impact: m,
      }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    const text = await ar.text();
    let a = {};
    try { a = JSON.parse(text); } catch {}
    if (!ar.ok || a.error || !a.rating) {
      const error = `assessment HTTP ${ar.status}: ${a.error || text.slice(0, 300)}`;
      writeCtx(c);
      await trace("assessmentFailed", "major", c.business_id, { params: { error } });
      out({ next: "error", error, business_id: c.business_id, case_id: c.case_id });
    }
    c.rating = a.rating;
    c.explanation = a.explanation;
    const summary = { rating: c.rating, explanation: c.explanation, case_id: c.case_id,
      contingent_plan_run_id: c.contingent_plan_run_id, impacted_demand_count: c.impacted_demand_count,
      delivery_delay_days: c.delivery_delay_days, quantity_decrease_pct: c.quantity_decrease_pct };

    if (c.rating === "LOW") { writeCtx(c); out({ next: "order", ...summary }); }

    // Step 1.6 — negotiation round N
    const n = Number(fs.existsSync(f.round) ? fs.readFileSync(f.round, "utf8") || 0 : 0) + 1;
    fs.writeFileSync(f.round, String(n));
    c.round = n;
    writeCtx(c);
    if (n > MAX_NEGOTIATION_ROUNDS) {
      await trace("negotiationExhausted", "major", c.business_id, { caseId: c.case_id, round: n });
      out({ next: "order", exhausted: true, round: n, ...summary });
    }

    // Baseline drift guard: if the case's active plan (pinned via "Set active", else the
    // latest saved/promoted run) is no longer this negotiation's baseline, it's stale.
    const runs = await fetch(`${ALLOCATOR}/cases/${c.case_id}/plan-runs`).then((x) => x.json()).catch(() => []);
    const active = (Array.isArray(runs) ? runs : []).find((p) => p.is_active);
    if (active && active.id !== c.plan_run_id) {
      await trace("baselineDrifted", "major", c.business_id, { caseId: c.case_id, sessionKey, latestPlanRunId: active.id });
      out({ next: "stop", reason: "baselineDrifted", latest_plan_run_id: active.id, ...summary });
    }

    await trace("negotiationWaiting", "waiting", c.business_id, waitingFields(c));
    const wr = await fetch(`${ALLOCATOR}/cases/${c.case_id}/negotiation-waits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKey, round: n, rating: c.rating, explanation: c.explanation,
        currentDelayDays: c.delivery_delay_days, currentQtyPct: c.quantity_decrease_pct,
        baselinePlanRunId: c.plan_run_id, contingentPlanRunId: c.contingent_plan_run_id,
        supplyId: c.supply_id, impactedDemandCount: c.impacted_demand_count,
      }),
    }).catch(() => null);
    out({ next: "wait", round: n, wait_registered: Boolean(wr?.ok), ...summary });
  },

  async reply() {
    const [action] = args;
    const c = readCtx();
    if (!c) fail(`no run context (${f.ctx}) — this session has no rated impact to negotiate`);
    const n = c.round;
    await trace("negotiationClassified", "detail", c.business_id, { caseId: c.case_id, round: n, action });

    if (action === "ambiguous") {
      await trace("negotiationAmbiguous", "detail", c.business_id, { caseId: c.case_id, round: n });
      await trace("negotiationWaiting", "waiting", c.business_id, waitingFields(c));
      out({ next: "wait", round: n });
    }
    if (fs.existsSync(f.orderSpawned)) {
      await trace("negotiationLateReplyIgnored", "detail", c.business_id, { caseId: c.case_id, round: n });
      out({ next: "stop", reason: "late reply — order already spawned" });
    }
    if (fs.existsSync(f.processed(n))) out({ next: "stop", outcome: "duplicate_negotiation_reply" });

    if (action === "keep") {
      touch(f.processed(n));
      await trace("negotiationKept", "major", c.business_id, { caseId: c.case_id, round: n });
      out({ next: "order", round: n });
    }
    if (action === "abandon") {
      touch(f.processed(n));
      await trace("negotiationAbandoned", "major", c.business_id, { caseId: c.case_id, round: n, sessionKey });
      out({ next: "finish", round: n });
    }
    if (action === "counter") {
      // `-` or a missing value keeps the current one.
      const [, d, q] = args;
      const pick = (v, cur) => (v === undefined || v === "" || v === "-" ? Number(cur ?? 0) : Number(v));
      const delay = pick(d, c.delivery_delay_days);
      const qty = pick(q, c.quantity_decrease_pct);
      if (!Number.isInteger(delay) || delay < 0) fail(`counter delay must be a whole number of days >= 0, got '${d}'`);
      if (!Number.isFinite(qty) || qty < 0 || qty > 100) fail(`counter quantity % must be 0-100, got '${q}'`);
      await submitEngine(c, {
        business_id: c.business_id, supply_id: c.supply_id, source: c.source,
        recipients: c.recipients, message_id: c.message_id,
        delivery_delay_days: delay, quantity_decrease_pct: qty,
        negotiation_round: n, parent_plan_run_id: c.contingent_plan_run_id,
        case_id: c.case_id, // keep counter rounds in the case round 1 ran in
      }, f.processed(n));
    }
    fail(`unknown action '${action}' (expected keep|abandon|counter|ambiguous)`);
  },

  async order() {
    const c = readCtx();
    if (!c) fail(`no run context (${f.ctx})`);
    const existing = confirmedChild("order", f.orderSpawned);
    if (existing) out({ next: "wait_order", child_session_key: existing });
    // The order step reuses this session's rating (same params, same assessment) and reads
    // the task from a file — `ord.sh start TASK_FILE` — so the agent never re-types JSON
    // that carries free text into a shell argument.
    const taskFile = `/tmp/ord_task_${uuid}.json`;
    if (!fs.existsSync(f.orderSpawned)) {
      await resolveWait(c.case_id);
      fs.writeFileSync(taskFile, spawnTask(c, "Order", {
        impacted_demand_count: c.impacted_demand_count, rating: c.rating, explanation: c.explanation,
        contingent_plan_run_id: c.contingent_plan_run_id, _material_session_key: sessionKey, task_file: taskFile,
      }));
      fs.writeFileSync(f.orderSpawned, "");
      await trace("engineComplete", "major", c.business_id, { caseId: c.case_id });
      await trace("orderSpawned", "waiting", c.business_id, { caseId: c.case_id });
    }
    const child = await spawnAgent("order", fs.readFileSync(taskFile, "utf8"));
    fs.writeFileSync(f.orderSpawned, child);
    out({ next: "wait_order", child_session_key: child });
  },

  async planning() {
    // Context normally comes from the ctx file; the order_complete payload (if given)
    // fills it in when /tmp was lost (e.g. a gateway container restart mid-run).
    let c = readCtx() || {};
    if (args[0]) {
      try {
        const o = JSON.parse(args[0]);
        c = { ...o, ...c };
      } catch { fail("ORDER_JSON is not valid JSON"); }
    }
    if (c.case_id == null || c.contingent_plan_run_id == null) fail("missing case_id / contingent_plan_run_id — pass the order_complete JSON");
    const existing = confirmedChild("planning", f.planning);
    if (existing) out({ next: "finish", child_session_key: existing });
    if (!fs.existsSync(f.planning)) {
      fs.writeFileSync(f.planning, "");
      await trace("orderApproved", "major", c.business_id, { caseId: c.case_id });
      await trace("planningSpawning", "detail", c.business_id, { caseId: c.case_id });
    }
    const child = await spawnAgent("planning", spawnTask(c, "Planning", { contingent_plan_run_id: c.contingent_plan_run_id }));
    fs.writeFileSync(f.planning, child);
    out({ next: "finish", child_session_key: child });
  },

  async finish() {
    const c = readCtx() || {};
    // A run that started a handoff must not close before the child exists — that is how
    // a skipped sessions_spawn used to end a run silently.
    for (const [agentId, marker] of [["order", f.orderSpawned], ["planning", f.planning]]) {
      if (fs.existsSync(marker) && !confirmedChild(agentId, marker)) {
        fail(`the ${agentId} agent was never spawned — run \`mat.sh ${agentId}\` first`);
      }
    }
    await trace("complete", "major", c.business_id, { sessionKey, ...(c.case_id ? { caseId: c.case_id } : {}) });
    await resolveWait(c.case_id);
    for (const p of fs.readdirSync("/tmp")) {
      if (p.includes(uuid) && (p.startsWith("mat_") || p.startsWith("ord_task_"))) fs.rmSync(`/tmp/${p}`, { force: true });
    }
    out({ ok: true });
  },
};

if (!commands[cmd]) fail(`unknown command '${cmd}' (start|submitted|rate|reply|order|planning|finish)`);
commands[cmd]().catch((e) => fail(String(e)));
