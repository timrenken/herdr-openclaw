// state 目录解析。herdr 调插件时会注入 HERDR_PLUGIN_STATE_DIR，但人从 shell 里
// 直接跑 bin/status.mjs 时没有 —— 那时必须落到 herdr 的约定路径上，否则会去看
// 一个空的 ./.state 然后报 "watcher 没在跑"，而实际上它跑得好好的。

import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "herdr-openclaw";

/** herdr 0.8.0 注入 HERDR_PLUGIN_STATE_DIR 时用的约定路径（实测取到的值）。 */
function conventionalStateDir() {
  const xdgState = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(xdgState, "herdr", "plugins", PLUGIN_ID);
}

export function stateDir() {
  return process.env.HERDR_PLUGIN_STATE_DIR || conventionalStateDir();
}

export function pidFile() {
  return join(stateDir(), "watch.pid");
}

export function logFile() {
  return join(stateDir(), "watch.log");
}
