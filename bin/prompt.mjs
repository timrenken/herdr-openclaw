#!/usr/bin/env node
// `agent prompt` 的等价物。原生那条对插件 agent 报
// agent_not_ready，见 README「与原生 agent 的能力差异」。
//
//   node bin/prompt.mjs <pane_id> <文本> [--wait] [--timeout <ms>]
//
// 默认只确认"提交成功"就返回；--wait 会一直等到跑完（idle/blocked）。
// 输出 JSON，便于编排层解析。

import { getAgent, isOpenClawPane, readPane, sendKeys, sendText } from "../lib/herdr.mjs";
import { parseOpenClawStatus } from "../lib/detect.mjs";
import { isSettled, isSubmitted, planPrompt } from "../lib/drive.mjs";
import { parseArgs } from "../lib/args.mjs";

const SUBMIT_TIMEOUT_MS = 15000;
const POLL_MS = 400;

function usage(msg) {
  console.error(`错误：${msg}\n用法：node bin/prompt.mjs <pane_id> <文本> [--wait] [--timeout <ms>]`);
  process.exit(2);
}

const { flags, opts, positional } = parseArgs(process.argv.slice(2), ["timeout"]);
const waitTimeoutMs = opts.timeout ? Number(opts.timeout) : 300000;

const paneId = positional[0];
const text = positional.slice(1).join(" ");
if (!paneId) usage("缺 pane_id");
if (!text) usage("缺文本");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot() {
  const status = parseOpenClawStatus(readPane(paneId));
  const agent = getAgent(paneId);
  return { status, seq: agent?.state_change_seq ?? null, sessionId: status.sessionId };
}

// 两道门，缺一不可。
//
// 屏幕文本判据（status.matched）单独用是**不安全**的：它只要求 pane 尾部出现状态行的
// 形状，而任何显示着 OpenClaw 采样文本的 shell pane 都满足——本仓库的 docs 和测试
// 文件里就印着完整状态行，`cat` 一下就能骗过它。往 shell 里送文本 + 回车 =
// 把内容当命令执行。所以先查前台进程 argv0，这才是硬判据。
if (!isOpenClawPane(paneId)) {
  console.log(
    JSON.stringify({
      ok: false,
      error: "pane_not_openclaw",
      detail:
        "这个 pane 的前台进程不是 openclaw tui。拒绝送入 —— 否则文本和回车会被当成 shell 命令执行。",
    }),
  );
  process.exit(1);
}

const before = snapshot();
if (!before.status.matched) {
  console.log(
    JSON.stringify({
      ok: false,
      error: "status_line_unreadable",
      detail:
        "前台进程是 OpenClaw，但读不到状态行（可能正在重绘）。稍后重试；" +
        "此时提交无法确认，故不发送。",
    }),
  );
  process.exit(1);
}

let steps;
try {
  steps = planPrompt(text);
} catch (err) {
  usage(err.message);
}

for (const step of steps) {
  if (step.op === "send-text") sendText(paneId, step.text);
  else sendKeys(paneId, ...step.keys);
}

// 确认提交 —— 绝不盲发返回。
let submitted = { submitted: false, evidence: null };
const submitDeadline = Date.now() + SUBMIT_TIMEOUT_MS;
while (Date.now() < submitDeadline) {
  await sleep(POLL_MS);
  submitted = isSubmitted(before, snapshot());
  if (submitted.submitted) break;
}

if (!submitted.submitted) {
  console.log(
    JSON.stringify({
      ok: false,
      error: "not_submitted",
      detail:
        "送了文本和回车，但既没看到 TUI 进入 busy，herdr 的 state_change_seq 也没变。" +
        "文字可能还停在输入框里（send-text 不带回车的老坑），或者 watcher 没在跑。",
      tail: readPane(paneId, 12).split("\n").slice(-6),
    }),
  );
  process.exit(1);
}

if (!flags.has("--wait")) {
  console.log(JSON.stringify({ ok: true, submitted: true, evidence: submitted.evidence }));
  process.exit(0);
}

const waitDeadline = Date.now() + waitTimeoutMs;
// 跑完的那一刻 busy 行已经没了，elapsed 也随之消失 —— 想报出用时只能一路记住
// 最后一次读到的值（与 watcher 里 lastElapsed 同一个道理）。
let lastElapsed = null;
while (Date.now() < waitDeadline) {
  await sleep(POLL_MS);
  const s = parseOpenClawStatus(readPane(paneId));
  if (s.busy && s.elapsed) lastElapsed = s.elapsed;
  if (isSettled(s)) {
    console.log(
      JSON.stringify({
        ok: true,
        submitted: true,
        evidence: submitted.evidence,
        state: s.state,
        elapsed: lastElapsed,
      }),
    );
    process.exit(0);
  }
}

console.log(
  JSON.stringify({ ok: false, error: "wait_timeout", submitted: true, evidence: submitted.evidence }),
);
process.exit(1);
