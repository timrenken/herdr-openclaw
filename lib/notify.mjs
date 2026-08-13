// 通知策略。纯决策，不碰 IO —— 实际发送在 lib/herdr.mjs 的 showNotification。
//
// 设计前提：**不发明第二套配置**。`notification.show` 本身就走用户的 `[ui.toast]`，
// herdr 侧已经处理了投递方式（herdr/terminal/system/off）、位置、延迟和限流
// —— 返回的 reason 枚举就是证据：shown / disabled / rate_limited /
// no_foreground_client / busy。所以这里只决定三件原生也在决定的事：
//   1. 什么时候该响（哪些状态迁移）
//   2. 用哪个音效语义（done vs request）
//   3. 这个 agent 是不是被用户静音了（[ui.sound.agents]）
//
// 触发时机对齐 herdr 文档对原生 agent 的描述："notify you when a background
// agent finishes or needs input"。两点由此而来：
//   - 只有「完成」和「需要输入」两类，不为 error/断连发（原生也不发）
//   - "background" ——正在看的那个 pane 不打扰

/** 从 idle/working/blocked/unknown 的迁移里判断要不要响、响哪种。 */
export function decideNotification(prev, next, { focused = false, elapsed = null } = {}) {
  // 首次观测（接管、watcher 重启）不补发：否则重启一次就把所有已完成的面板
  // 全弹一遍，而这些结果用户早就看过了。
  if (prev == null) return null;
  if (prev === next) return null;
  // 正在看的 pane 不打扰 —— 对齐原生的 "background agent" 语义。
  if (focused) return null;

  if (next === "blocked") {
    return { kind: "blocked", sound: "request" };
  }
  // 只有「从干活变成不干活」才算完成。idle→idle、unknown→idle 这类不是。
  if (prev === "working" && (next === "idle" || next === "done")) {
    return { kind: "done", sound: "done", elapsed };
  }
  return null;
}

/** 标题带 agent 名和 pane，多面板时才分得清是哪个在叫。 */
export function buildNotification(decision, { agentName, paneId, model } = {}) {
  const who = agentName ? `OpenClaw · ${agentName}` : "OpenClaw";
  if (decision.kind === "blocked") {
    return {
      title: `${who} 需要你`,
      body: [paneId, model].filter(Boolean).join(" · ") || undefined,
      sound: decision.sound,
    };
  }
  const took = decision.elapsed ? `用时 ${decision.elapsed}` : null;
  return {
    title: `${who} 跑完了`,
    body: [took, paneId].filter(Boolean).join(" · ") || undefined,
    sound: decision.sound,
  };
}

/**
 * 音效开关，取自插件配置的 `sound`（on / off）。
 * off 时降级成静音通知——还是弹，只是不响，跟原生 sound 开关的语义一致。
 *
 * 注意别改回读 herdr 的 `[ui.sound.agents]`：那个键是**已知 agent 的枚举**，
 * 实测 herdr 会把 `ui.sound.agents.openclaw` 判成 unknown config key。
 */
export function applySoundPolicy(notification, soundPolicy) {
  if (soundPolicy === "off") return { ...notification, sound: "none" };
  return notification;
}
