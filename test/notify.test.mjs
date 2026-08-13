import assert from "node:assert/strict";
import { test } from "node:test";

import { applySoundPolicy, buildNotification, decideNotification } from "../lib/notify.mjs";
import { readConfig } from "../lib/plugin-config.mjs";

test("跑完了：working -> done/idle 用 done 音效", () => {
  for (const next of ["done", "idle"]) {
    const d = decideNotification("working", next, { elapsed: "36s" });
    assert.equal(d?.kind, "done", next);
    assert.equal(d?.sound, "done", next);
    assert.equal(d?.elapsed, "36s", next);
  }
});

test("需要你：任何状态 -> blocked 用 request 音效", () => {
  for (const prev of ["idle", "working", "unknown"]) {
    const d = decideNotification(prev, "blocked", {});
    assert.equal(d?.kind, "blocked", prev);
    assert.equal(d?.sound, "request", prev);
  }
});

test("首次观测不补发 —— watcher 重启不该把已完成的面板全弹一遍", () => {
  assert.equal(decideNotification(null, "idle", {}), null);
  assert.equal(decideNotification(null, "done", {}), null);
  assert.equal(decideNotification(null, "blocked", {}), null);
});

test("正在看的 pane 不打扰（对齐原生的 background agent 语义）", () => {
  assert.equal(decideNotification("working", "done", { focused: true }), null);
  assert.equal(decideNotification("idle", "blocked", { focused: true }), null);
});

test("状态没变不发", () => {
  assert.equal(decideNotification("idle", "idle", {}), null);
  assert.equal(decideNotification("working", "working", {}), null);
});

test("不是从干活变成不干活的，不算完成", () => {
  // unknown->idle 是状态行终于读出来了，不是跑完了
  assert.equal(decideNotification("unknown", "idle", {}), null);
  assert.equal(decideNotification("blocked", "idle", {}), null);
});

test("出错和断连不发 —— 原生也只管完成和需要输入两类", () => {
  assert.equal(decideNotification("working", "unknown", {}), null);
  assert.equal(decideNotification("idle", "unknown", {}), null);
});

test("标题带 agent 名，多面板时分得清谁在叫", () => {
  const done = buildNotification(
    { kind: "done", sound: "done", elapsed: "36s" },
    { agentName: "her", paneId: "w1P:p2" },
  );
  assert.equal(done.title, "OpenClaw · her 跑完了");
  assert.match(done.body, /36s/);
  assert.match(done.body, /w1P:p2/);

  const blocked = buildNotification(
    { kind: "blocked", sound: "request" },
    { agentName: "main", paneId: "w1P:p1", model: "claude-cli/claude-opus-5" },
  );
  assert.equal(blocked.title, "OpenClaw · main 需要你");
});

test("没解出 agent 名时标题也不能是空的", () => {
  const n = buildNotification({ kind: "done", sound: "done" }, { paneId: "w1:p1" });
  assert.equal(n.title, "OpenClaw 跑完了");
});

test("没有耗时就不硬凑用时", () => {
  const n = buildNotification({ kind: "done", sound: "done", elapsed: null }, { paneId: "w1:p1" });
  assert.equal(n.body, "w1:p1");
});

test("sound 配 off 时降级为静音，但仍然弹", () => {
  const n = buildNotification({ kind: "done", sound: "done" }, { paneId: "w1:p1" });
  assert.equal(applySoundPolicy(n, "off").sound, "none");
  assert.equal(applySoundPolicy(n, "on").sound, "done");
  assert.equal(applySoundPolicy(n, null).sound, "done");
});

test("插件配置缺省时全部走默认：通知开、有声、不打扰聚焦 pane", () => {
  assert.deepEqual(readConfig(""), { notify: true, sound: "on", notifyFocused: false });
  assert.deepEqual(readConfig("{}"), { notify: true, sound: "on", notifyFocused: false });
});

test("插件配置能关总开关、能静音、能要求聚焦时也通知", () => {
  assert.equal(readConfig('{"notify":false}').notify, false);
  assert.equal(readConfig('{"sound":"off"}').sound, "off");
  assert.equal(readConfig('{"notifyFocused":true}').notifyFocused, true);
});

test("配置坏了退回默认，不能让 watcher 挂掉", () => {
  for (const bad of ["{ 这不是 json", "null", "[]", '"字符串"', '{"sound":123}']) {
    const c = readConfig(bad);
    assert.equal(c.notify, true, bad);
    assert.equal(c.sound, "on", bad);
  }
});
