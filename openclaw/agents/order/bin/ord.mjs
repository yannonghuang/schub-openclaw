// Deterministic steps of the order workflow. The agent keeps the one judgement call —
// classifying the human's reply to the approval email — and these commands do
// everything else: session key, run context, rating, traces, approval and notification
// emails, and the callback that wakes the spawning material session.
//
// Run context lives in /tmp/ord_ctx_<uuid>.json, so the reply turn (a resume, possibly
// hours later) reads ids from it instead of recovering them from session history.
//
// Usage: sh ord.sh <command> [args]   — every command prints one JSON line.
//   start TASK            fresh task (TASK = task file path or task JSON): rate, then
//                         auto-approve (LOW) or send the approval email (MEDIUM/HIGH)
//   decide ACTION         reply turn: approved | rejected | needs_more_time
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const BIN = "/home/node/.openclaw/agents/order/bin";
const SESSION_SEND = "/home/node/.openclaw/agents/material/bin/session_send.sh";
const ALLOCATOR = "http://allocator-backend:8000";
const BACKEND = process.env.BACKEND_URL || "http://auth-service:4000";

const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const fail = (msg) => { console.log(JSON.stringify({ error: msg })); process.exit(1); };

// ORD_SESSION_UUID: test override, so the commands can be exercised outside an agent turn.
const uuid = process.env.ORD_SESSION_UUID || execFileSync("sh", [`${BIN}/session_key.sh`], { encoding: "utf8" }).trim();
if (!uuid) fail("could not resolve this session's key (session_key.sh returned nothing)");
const sessionKey = `agent:order:subagent:${uuid}`;

const f = { lock: `/tmp/ord_lock_${uuid}`, ctx: `/tmp/ord_ctx_${uuid}.json` };
const readCtx = () => { try { return JSON.parse(fs.readFileSync(f.ctx, "utf8")); } catch { return null; } };
const writeCtx = (c) => fs.writeFileSync(f.ctx, JSON.stringify(c));

// node:http, not fetch: switch-service listens on 6000, a fetch-spec "bad port" (X11)
// that undici refuses outright.
function switchRequest(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: "switch-service", port: 6000, path, method, timeout: 5000,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (res) => { let s = ""; res.on("data", (d) => (s += d)); res.on("end", () => resolve(s)); },
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
    req.end(data);
  });
}

async function trace(step, level, businessId, extra = {}) {
  // sessionKey lets switch-service attribute the trace to the chat thread that owns this
  // run, and retires this session on the terminal trace.
  const value = { step: `trace.order.${step}`, agent: "order", level, businessId, sessionKey, ...extra };
  await switchRequest("POST", "/publish", {
    sender: "-1",
    content: JSON.stringify({ type: "CustomEvent", name: "schub/trace", value }),
    recipients: ["-2"],
  });
}

async function locale(businessId) {
  try { return JSON.parse(await switchRequest("GET", `/locale/${businessId}`)).locale === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}

// session_key + agent_id make it a HITL email: the adaptor resumes this session with the reply.
async function sendEmail(c, subject, body, hitl) {
  const r = await fetch(`${BACKEND}/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      business_id: c.business_id, recipients: [c.source ?? c.business_id], subject, body,
      ...(hitl ? { session_key: sessionKey, agent_id: "order" } : {}),
    }),
  }).catch((e) => ({ ok: false, status: String(e) }));
  if (!r.ok) fail(`send-email failed: ${r.status}`);
}

const change = (c, zh) => {
  const parts = [];
  if (c.quantity_decrease_pct) parts.push(zh ? `数量减少 ${c.quantity_decrease_pct}%` : `quantity -${c.quantity_decrease_pct}%`);
  if (c.delivery_delay_days) parts.push(zh ? `交期延迟 ${c.delivery_delay_days} 天` : `delivery +${c.delivery_delay_days} days`);
  return parts.join(zh ? "，" : ", ") || (zh ? "无变化" : "no change");
};

function approvalEmail(c, zh) {
  return zh
    ? {
        subject: `需审批：供应 ${c.supply_id} 变更（影响评级 ${c.rating}）`,
        body: `物料供应 ${c.supply_id} 发生变更：${change(c, true)}。\n\n影响评级：${c.rating}\n受影响需求数：${c.impacted_demand_count ?? "未知"}\n说明：${c.explanation}\n\n请回复本邮件：同意（批准）或拒绝。`,
      }
    : {
        subject: `Approval required: supply ${c.supply_id} change (impact ${c.rating})`,
        body: `Supply ${c.supply_id} is changing: ${change(c, false)}.\n\nImpact rating: ${c.rating}\nImpacted demands: ${c.impacted_demand_count ?? "unknown"}\nExplanation: ${c.explanation}\n\nPlease reply to this email to approve or reject.`,
      };
}

function resultEmail(c, zh, outcome) {
  const o = { approved: zh ? "已批准" : "approved", rejected: zh ? "已被人工审核员拒绝" : "rejected by human approver" }[outcome];
  return zh
    ? { subject: "订单分析结果", body: `订单分析完成。结果：${o}。影响评级：${c.rating}。${c.explanation}\n供应：${c.supply_id}（${change(c, true)}）。` }
    : { subject: "Order Analysis Result", body: `Order analysis complete. Outcome: ${o}. Impact rating: ${c.rating}. ${c.explanation}\nSupply: ${c.supply_id} (${change(c, false)}).` };
}

// Wakes the spawning material session with the outcome (it spawns planning on approval).
function callbackMaterial(c, outcome, extra = {}) {
  const payload = {
    type: "order_complete", outcome, business_id: c.business_id, message_id: c.message_id,
    source: c.source, recipients: c.recipients, materials: c.materials, supply_id: c.supply_id,
    quantity_decrease_pct: c.quantity_decrease_pct, delivery_delay_days: c.delivery_delay_days,
    rating: c.rating, explanation: c.explanation, case_id: c.case_id, plan_run_id: c.plan_run_id,
    contingent_plan_run_id: c.contingent_plan_run_id, ...extra,
  };
  if (c._material_session_key) {
    try {
      const res = execFileSync("sh", [SESSION_SEND, c._material_session_key, JSON.stringify(payload)], { encoding: "utf8" });
      if (!res.includes("callback_dispatched")) fail(`material callback failed: ${res.trim()}`);
    } catch (e) {
      fail(`material callback failed: ${String(e.stdout || e.message).trim()}`);
    }
  }
  return payload;
}

async function finish(c, outcome, final) {
  c.done = true;
  c.outcome = outcome;
  writeCtx(c);
  await trace("complete", "major", c.business_id);
  out({ next: "done", final });
}

async function approve(c) {
  const zh = (await locale(c.business_id)) === "zh";
  await trace("approved", "major", c.business_id);
  await trace("sendingNotification", "detail", c.business_id);
  const e = resultEmail(c, zh, "approved");
  await sendEmail(c, e.subject, e.body, false);
  await trace("returningControl", "detail", c.business_id);
  const payload = callbackMaterial(c, "approved");
  await finish(c, "approved", payload);
}

async function reject(c) {
  const zh = (await locale(c.business_id)) === "zh";
  await trace("rejected", "major", c.business_id);
  const e = resultEmail(c, zh, "rejected");
  await sendEmail(c, e.subject, e.body, false);
  callbackMaterial(c, "rejected");
  await finish(c, "rejected", { outcome: "rejected" });
}

async function assessmentFailed(c, error) {
  const zh = (await locale(c.business_id)) === "zh";
  await trace("assessmentFailed", "major", c.business_id, { params: { error } });
  await sendEmail(
    c,
    zh ? "订单评估失败" : "Order Analysis Failed",
    zh ? `订单评估服务不可用，无法确定影响评级。请在服务恢复后重试。\n错误：${error}`
       : `The order assessment service was unavailable, so no impact rating was determined. Please retry once service is restored.\nError: ${error}`,
    false,
  );
  callbackMaterial(c, "error", { error });
  await finish(c, "error", { outcome: "error", error, session_key: sessionKey });
}

// The material agent passes the rating it computed for these exact params; a task from
// elsewhere gets rated here by the allocator's assessment (the same one order_engine used).
async function rate(c) {
  if (c.rating && c.explanation) return null;
  const r = await fetch(`${ALLOCATOR}/material-impact-assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      supplyId: c.supply_id, deliveryDelayDays: c.delivery_delay_days ?? 0,
      quantityDecreasePct: c.quantity_decrease_pct ?? 0, caseId: c.case_id,
      ...(c.plan_run_id != null ? { planRunId: c.plan_run_id } : {}),
    }),
  }).catch((e) => ({ ok: false, status: String(e), json: async () => ({}) }));
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !["LOW", "MEDIUM", "HIGH"].includes(a.rating)) return `assessment returned ${r.status}: ${a.error ?? a.message ?? "no rating"}`;
  c.rating = a.rating;
  c.explanation = a.explanation;
  c.impacted_demand_count = a.impactedDemandCount;
  return null;
}

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  async start() {
    const [arg] = args;
    if (!arg) fail("usage: ord.sh start TASK_FILE_OR_JSON");
    let task;
    try { task = JSON.parse(arg.trim().startsWith("{") ? arg : fs.readFileSync(arg, "utf8")); }
    catch (e) { fail(`could not read task: ${e.message}`); }
    if (task.business_id == null || !task.supply_id || task.case_id == null) fail("task needs business_id, supply_id and case_id");
    try { fs.writeFileSync(f.lock, "", { flag: "wx" }); } catch { out({ next: "stop", outcome: "duplicate" }); }

    const c = { ...task, quantity_decrease_pct: task.quantity_decrease_pct ?? 0, delivery_delay_days: task.delivery_delay_days ?? 0 };
    writeCtx(c);
    await trace("engineStarted", "major", c.business_id);
    const err = await rate(c);
    writeCtx(c);
    if (err) await assessmentFailed(c, err);
    await trace("engineComplete", "major", c.business_id, { params: { rating: c.rating } });
    if (c.rating === "LOW") await approve(c);

    const zh = (await locale(c.business_id)) === "zh";
    await trace("composingApproval", "detail", c.business_id);
    const e = approvalEmail(c, zh);
    await sendEmail(c, e.subject, e.body, true);
    await trace("awaitingApproval", "waiting", c.business_id);
    out({ next: "wait_approval", final: { outcome: "pending_approval", session_key: sessionKey } });
  },

  async decide() {
    const [action] = args;
    const c = readCtx();
    if (!c) fail(`no run context (${f.ctx}) — this session has no pending approval`);
    if (c.done) out({ next: "done", final: { outcome: c.outcome, note: "already_processed" } });
    if (action === "approved") await approve(c);
    if (action === "rejected") await reject(c);
    if (action === "needs_more_time") {
      const zh = (await locale(c.business_id)) === "zh";
      await trace("resendingApproval", "waiting", c.business_id);
      const e = approvalEmail(c, zh);
      await sendEmail(c, e.subject, e.body, true);
      out({ next: "wait_approval", final: { outcome: "pending_approval_resent", session_key: sessionKey } });
    }
    fail(`unknown action '${action}' (expected approved|rejected|needs_more_time)`);
  },
};

if (!commands[cmd]) fail(`unknown command '${cmd}' (start|decide)`);
commands[cmd]().catch((e) => fail(String(e)));
