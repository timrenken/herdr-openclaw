import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { pidFile, stateDir } from "../lib/paths.mjs";

const ENV_KEYS = ["HERDR_PLUGIN_STATE_DIR", "XDG_STATE_HOME"];

// paths.mjs 在**调用时**读环境变量（不是 import 时），所以求值必须发生在
// 环境还没被还原的窗口里 —— 早期这条测试就是栽在提前还原上。
function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("herdr 注入 HERDR_PLUGIN_STATE_DIR 时以它为准", () => {
  withEnv({ HERDR_PLUGIN_STATE_DIR: "/tmp/injected" }, () => {
    assert.equal(stateDir(), "/tmp/injected");
    assert.equal(pidFile(), join("/tmp/injected", "watch.pid"));
  });
});

test("从 shell 直接跑（没有注入）时落到 herdr 约定路径，而不是 ./.state", () => {
  withEnv({ HERDR_PLUGIN_STATE_DIR: undefined, XDG_STATE_HOME: undefined }, () => {
    const want = join(homedir(), ".local", "state", "herdr", "plugins", "herdr-openclaw");
    assert.equal(stateDir(), want);
  });
});

test("尊重 XDG_STATE_HOME", () => {
  withEnv({ HERDR_PLUGIN_STATE_DIR: undefined, XDG_STATE_HOME: "/tmp/xdg" }, () => {
    assert.equal(stateDir(), join("/tmp/xdg", "herdr", "plugins", "herdr-openclaw"));
  });
});
