import assert from "node:assert/strict";
import { test } from "node:test";

import { isSettled, isSubmitted, planPrompt } from "../lib/drive.mjs";
import { parseArgs } from "../lib/args.mjs";

const st = (o = {}) => ({ matched: true, busy: false, state: "idle", ...o });

test("提交必须先送文本、再单独回车 —— 不许合成一步", () => {
  const steps = planPrompt("你好");
  assert.deepEqual(steps, [
    { op: "send-text", text: "你好" },
    { op: "send-keys", keys: ["enter"] },
  ]);
});

test("空文本和多行文本直接拒绝", () => {
  assert.throws(() => planPrompt(""), /不能为空/);
  assert.throws(() => planPrompt(null), /不能为空/);
  assert.throws(() => planPrompt("第一行\n第二行"), /不能含换行/);
});

test("TUI 进入 busy 是最直接的提交证据", () => {
  const r = isSubmitted({ seq: 10, sessionId: "s1" }, { status: st({ busy: true }), seq: 10 });
  assert.equal(r.submitted, true);
  assert.equal(r.evidence, "busy");
});

test("跑太快没抓到 busy 时，靠 state_change_seq 变化兜底", () => {
  const r = isSubmitted(
    { seq: 10, sessionId: "s1" },
    { status: st({ busy: false }), seq: 11, sessionId: "s1" },
  );
  assert.equal(r.submitted, true);
  assert.equal(r.evidence, "state_change_seq");
});

test("会话换了也算提交成功", () => {
  const r = isSubmitted(
    { seq: 10, sessionId: "s1" },
    { status: st(), seq: 10, sessionId: "s2" },
  );
  assert.equal(r.submitted, true);
  assert.equal(r.evidence, "session");
});

test("什么都没变就是没提交 —— 这正是文字还停在输入框的情形", () => {
  const r = isSubmitted(
    { seq: 10, sessionId: "s1" },
    { status: st(), seq: 10, sessionId: "s1" },
  );
  assert.equal(r.submitted, false);
});

test("seq 缺失（watcher 没跑）时不能凭空判成提交", () => {
  const r = isSubmitted(
    { seq: null, sessionId: "s1" },
    { status: st(), seq: null, sessionId: "s1" },
  );
  assert.equal(r.submitted, false);
});

test("跑完的判据：不 busy 且落到 idle/blocked", () => {
  assert.equal(isSettled(st({ state: "idle" })), true);
  assert.equal(isSettled(st({ state: "blocked" })), true);
  assert.equal(isSettled(st({ state: "working", busy: true })), false);
  // busy 为真时哪怕状态字段还写着 idle 也不算停 —— busy 行才是权威
  assert.equal(isSettled(st({ state: "idle", busy: true })), false);
  assert.equal(isSettled(st({ state: "unknown" })), false);
  assert.equal(isSettled({ matched: false }), false);
});

test("argv 拆解不会把带值选项的值当成位置参数", () => {
  const r = parseArgs(["w1:p1", "--lines", "60", "--transcript"], ["lines", "source"]);
  assert.deepEqual(r.positional, ["w1:p1"]); // 60 不能混进来
  assert.equal(r.opts.lines, "60");
  assert.equal(r.flags.has("--transcript"), true);
});

test("位置参数在选项之后也认得出来", () => {
  const r = parseArgs(["--timeout", "5000", "w2:p3", "写点什么"], ["timeout"]);
  assert.deepEqual(r.positional, ["w2:p3", "写点什么"]);
  assert.equal(r.opts.timeout, "5000");
});
