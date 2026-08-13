// 派活给 OpenClaw 面板。`agent prompt` 对插件 agent 报
// `agent_not_ready: not an active named agent`（那个身份只有 `agent start` 能给，
// 而 --kind 是编译进二进制的枚举），所以只能在 pane 层重做一遍。
//
// 关键不是"把字送进去"，是**确认真的提交了**。有一条实测教训
// 那条坑在这条路上同样成立：send-text 只是把字放进输入框，不回车就什么都没发生，
// 而且**盲发不可接受**——编排层会以为任务在跑，其实字还停在输入框里。
//
// 本模块只做判定，IO 在调用方；这样提交确认的逻辑能离线测。

/** 提交确认的判据。任一成立即认为已提交。 */
export function isSubmitted(before, after) {
  // 1) TUI 进入 busy —— 最直接的证据，run 真的起来了
  if (after.status?.busy) return { submitted: true, evidence: "busy" };
  // 2) herdr 侧状态序号变了 —— 覆盖"跑得太快，轮询没抓到 busy"的情形。
  //    注意它依赖 watcher 在跑；watcher 停了这条就永远不成立，所以不能只靠它。
  if (
    before.seq != null &&
    after.seq != null &&
    after.seq !== before.seq
  ) {
    return { submitted: true, evidence: "state_change_seq" };
  }
  // 3) 会话换了（比如提交触发了新会话）
  if (before.sessionId && after.sessionId && before.sessionId !== after.sessionId) {
    return { submitted: true, evidence: "session" };
  }
  return { submitted: false, evidence: null };
}

/** 跑完了没有。对齐 herdr 的终态语义：done / idle / blocked 都算停下来了。 */
export function isSettled(status) {
  if (!status?.matched) return false;
  if (status.busy) return false;
  return ["idle", "blocked"].includes(status.state);
}

/**
 * 把一次 prompt 拆成可执行的步骤描述，供 bin/prompt.mjs 按序执行。
 * 拆出来是为了让"先送文本、再单独回车"这条约束显式可测 ——
 * 合成一步的写法看起来更短，但正是踩过的那个坑。
 */
export function planPrompt(text) {
  if (typeof text !== "string" || !text.length) {
    throw new Error("prompt 文本不能为空");
  }
  if (text.includes("\n")) {
    // 多行会被 TUI 当成多次输入或直接触发提交，语义不可控。
    throw new Error("prompt 文本不能含换行；多行内容请改用文件或单行拼接");
  }
  return [
    { op: "send-text", text },
    { op: "send-keys", keys: ["enter"] },
  ];
}
