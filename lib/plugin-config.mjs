// 插件自己的配置。位置由 herdr 给：调插件时注入 HERDR_PLUGIN_CONFIG_DIR，
// 人从 shell 直接跑时落到同一条约定路径（跟 lib/paths.mjs 一个道理）。
//
// 为什么不复用 herdr 的 `[ui.sound.agents]`：**实测 herdr 会拒绝这个键**——
//
//   $ herdr config check
//   unknown config key ui.sound.agents.openclaw; ignoring key
//
// 同一份配置里 `ui.sound.agents.hermes` 不报错，说明那是**已知 agent 的枚举**，
// 不是开放 map。往里塞 openclaw 功能上能work（我们自己读文件），但会让用户的
// `config check` 永久多一条警告——那是占用 herdr 会校验的命名空间，不是"和原生一致"。
// 插件配置目录才是 herdr 给插件留的正规位置。
//
// 仍然刻意**不接管**投递方式/位置/延迟/限流：那些 `notification.show` 走用户的
// `[ui.toast]`，herdr 侧已经决定完了，插件这里再开一份就是让配置漂移。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "herdr-openclaw";

export function configDir() {
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) return process.env.HERDR_PLUGIN_CONFIG_DIR;
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "herdr", "plugins", "config", PLUGIN_ID);
}

export function configFile() {
  return join(configDir(), "config.json");
}

const DEFAULTS = {
  /** 总开关。false 时一条都不发。 */
  notify: true,
  /** 音效：on = 用 herdr 的 done/request 音；off = 照常弹但不响。 */
  sound: "on",
  /** 正在看的 pane 要不要也通知。默认不打扰，对齐原生的 background 语义。 */
  notifyFocused: false,
};

/**
 * 读插件配置，缺项用默认值补齐。
 * 读不到/坏了都退回默认 —— 配置问题不该让 watcher 挂掉。
 */
export function readConfig(text = null) {
  const raw = text ?? readFileSafe();
  if (!raw) return { ...DEFAULTS };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
  return {
    notify: typeof parsed.notify === "boolean" ? parsed.notify : DEFAULTS.notify,
    sound: parsed.sound === "off" ? "off" : DEFAULTS.sound,
    notifyFocused:
      typeof parsed.notifyFocused === "boolean" ? parsed.notifyFocused : DEFAULTS.notifyFocused,
  };
}

function readFileSafe() {
  const p = configFile();
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
