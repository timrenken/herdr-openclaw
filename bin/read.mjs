#!/usr/bin/env node
// `agent read` 的等价物。原生那条对插件 agent **退出码 0 但返回空**
// （`pane read` 是好的，两条是不同路径），见 README「与原生 agent 的能力差异」。
//
//   node bin/read.mjs <pane_id> [--lines N] [--source detection|recent|recent-unwrapped|visible]
//                               [--transcript] [--json]
//
// --transcript 会把 TUI 的状态行、info 行和分隔线剥掉，只留对话正文 ——
// 编排层想拿"它回了什么"的时候要的是这个，而不是整屏。

import { readPane } from "../lib/herdr.mjs";
import { parseOpenClawStatus } from "../lib/detect.mjs";

import { parseArgs } from "../lib/args.mjs";

const { flags, opts, positional } = parseArgs(process.argv.slice(2), ["lines", "source"]);
const opt = (name, fallback) => opts[name] ?? fallback;
const paneId = positional[0];

if (!paneId) {
  console.error("用法：node bin/read.mjs <pane_id> [--lines N] [--source S] [--transcript] [--json]");
  process.exit(2);
}

const lines = Number(opt("lines", 60));
const source = opt("source", "detection");
const raw = readPane(paneId, lines, source);

// TUI 的框架行：状态行、info 行、分隔线。剥掉才是对话正文。
const CHROME = [
  /^\s*(?:gateway\s+)?(?:connected|connecting|disconnected)\s*\|/i, // 空闲状态行
  /•.*\|\s*(?:gateway\s+)?(?:connected|connecting|disconnected)\s*$/i, // busy 状态行
  /^\s*agent\s+.+\|\s*session\s+/i, // info 行
  /^\s*[─—]{5,}\s*$/, // 分隔线
];

const transcript = raw
  .split("\n")
  .filter((l) => !CHROME.some((re) => re.test(l)))
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const body = flags.has("--transcript") ? transcript : raw;

if (flags.has("--json")) {
  const status = parseOpenClawStatus(raw);
  console.log(
    JSON.stringify(
      {
        pane_id: paneId,
        state: status.state,
        busy: status.busy,
        session: status.sessionId,
        model: status.model,
        // 两个都给：transcript 是编排通常要的"它回了什么"，text 是原始整屏，
        // 排查解析问题时要看后者。
        transcript,
        text: raw,
      },
      null,
      2,
    ),
  );
} else {
  console.log(body);
}
