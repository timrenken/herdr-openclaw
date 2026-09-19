#!/usr/bin/env node
// herdr-openclaw watcher —— 插件的核心。
//
// herdr 的 agent 检测是 manifest 驱动的，但 manifest 只能给它**已知**的 21 个
// agent id 调规则，塞一个新 id 会被静默丢弃（实测，见 docs/findings-2026-08-12.md）。
// 所以 OpenClaw 只能走另一条路：由外部进程通过 pane.report_agent 主动上报状态，
// herdr 会把这个 pane 当成 agent 一等公民对待（在 agent list / 侧栏 / herdroid 里都可见）。
//
// 本进程做四件事，每轮一次：
//   1. 扫 pane，找前台跑着 openclaw-tui 的
//   2. 读尾部，解析出 herdr 四态
//   3. 状态或会话变了就上报
//   4. pane 不再跑 OpenClaw 就交还 authority
//
// 幂等：只在变化时发请求。watcher 重启后第一轮会把当前状态全量重发一次。

import {
  AGENT_LABEL,
  isOpenClawPane,
  listPanes,
  readPane,
  releaseAgent,
  reportAgent,
  reportAgentSession,
  reportMetadata,
  showNotification,
} from "../lib/herdr.mjs";
import { buildStateLabels, buildTokens, parseOpenClawStatus } from "../lib/detect.mjs";
import { formatDisplayAgent } from "../lib/identity.mjs";
import { metadataNeedsReport } from "../lib/metadata.mjs";
import { readConfig } from "../lib/plugin-config.mjs";
import { applySoundPolicy, buildNotification, decideNotification } from "../lib/notify.mjs";

const POLL_MS = Number(process.env.HERDR_OPENCLAW_POLL_MS ?? 1200);
/** 发现新 OpenClaw pane 的扫描间隔。比状态轮询慢一档，见 tick() 注释。 */
const DISCOVERY_MS = Number(process.env.HERDR_OPENCLAW_DISCOVERY_MS ?? 5000);
// 元数据 TTL 给轮询间隔的若干倍：watcher 意外退出后，侧栏的陈旧 token 会自己消失，
// 不会留下一个看起来还在跑、其实早没人管的面板。
const META_TTL_MS = Math.max(POLL_MS * 8, 15000);
// 但带 TTL 就必须续期。只在"值变了才重发"会让元数据一到期就永久消失
// （真机复现：15 秒后 agent get 的 display_agent/tokens 全变 null）。
// 半个 TTL 续一次，留足重试余量。
const META_REFRESH_MS = Math.floor(META_TTL_MS / 2);

const VERBOSE = process.argv.includes("--verbose") || process.env.HERDR_OPENCLAW_VERBOSE === "1";
const ONCE = process.argv.includes("--once");

/** pane_id -> { state, sessionId, tokensKey, displayAgent, metaAt } 上一轮已上报的内容 */
const tracked = new Map();

function log(...args) {
  if (VERBOSE) console.error("[herdr-openclaw]", ...args);
}

function tokensKey(tokens) {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/**
 * 状态迁移时按需弹通知。
 * 投递方式/位置/延迟/限流一概不管 —— `notification.show` 走用户的 `[ui.toast]`，
 * herdr 侧已经决定完了。这里只管"该不该响、响哪种、是不是被静音"。
 */
function notifyTransition(paneId, prevState, nextState, ctx) {
  // 每次都读，不缓存：用户改完配置不该还要重启 watcher 才生效。
  // 一次状态迁移才读一个小文件，代价可以忽略。
  const cfg = readConfig();
  if (!cfg.notify) return;

  const decision = decideNotification(prevState, nextState, {
    focused: cfg.notifyFocused ? false : ctx.focused,
    elapsed: ctx.elapsed,
  });
  if (!decision) return;

  const notification = applySoundPolicy(
    buildNotification(decision, {
      agentName: ctx.agentName,
      paneId,
      model: ctx.model,
    }),
    cfg.sound,
  );

  const res = showNotification(notification);
  log(paneId, `notify ${decision.kind}`, res ? `-> ${res.reason}` : "-> 调用失败");
}

function syncPane(paneId, pane = null) {
  const status = parseOpenClawStatus(readPane(paneId));
  let prev = tracked.get(paneId);

  // agent authority 是按 source 记的，别的 source 对同一个 pane 调 report-agent
  // 会顶掉我们的（实测：另一个 source 报完再 release，该 pane 就变成无 agent）。
  // 我们只在状态**变化**时上报，所以一旦被顶掉，光靠状态机永远补不回来 ——
  // 这里显式检测：herdr 侧已经不认这个 pane 是 openclaw，就把记忆清掉重报一次。
  if (pane && pane.agent !== AGENT_LABEL) {
    log(paneId, `authority 丢失（herdr 侧 agent=${pane.agent ?? "无"}），重新接管`);
    prev = { ...prev, state: null, tokensKey: "", displayAgent: null, metaAt: 0 };
  }

  if (!status.matched) {
    // 进程在但状态行还没画出来（刚启动、或正在重绘）。
    // 报 unknown 而不是放着不管 —— 让面板显示"接管了但还看不出状态"。
    if (prev?.state !== "unknown") {
      reportAgent(paneId, "unknown", { message: "TUI 状态行未就绪" });
      tracked.set(paneId, {
        state: "unknown",
        sessionId: prev?.sessionId ?? null,
        tokensKey: "",
        lastElapsed: prev?.lastElapsed ?? null,
      });
      log(paneId, "-> unknown (状态行未就绪)");
    }
    return;
  }

  // 会话身份先于状态上报：herdr 用它把 pane 和一次具体会话绑起来，
  // 顺序反了的话第一次状态变化会挂在上一个 session 上。
  if (status.sessionId && status.sessionId !== prev?.sessionId) {
    reportAgentSession(paneId, status.sessionId);
    log(paneId, "session ->", status.sessionId);
  }

  // 上报成功与否决定 tracked 记什么。上报走 tryRun，失败只返回 null 不抛
  // （socket 抖动、超时都会走到这）。如果失败了还照常把新状态写进 tracked，
  // 下一轮就认为"已经报过了"不再重发 —— herdr 侧会**永久停在旧状态**，直到
  // 下一次状态迁移；编排的 `agent wait` 会挂到超时，而且一行日志都没有。
  // 元数据那条路有半 TTL 续期能自愈，状态这条没有，所以必须显式处理。
  let reportedState = prev?.state ?? null;
  if (status.state !== prev?.state) {
    const ok = reportAgent(paneId, status.state, {
      message: status.activity,
      sessionId: status.sessionId ?? undefined,
    });
    if (ok) {
      reportedState = status.state;
      log(paneId, `${prev?.state ?? "-"} -> ${status.state} (${status.activity})`);
      // 完成的那一刻 busy 行已经没了，耗时只能用最后一次看到的值。
      notifyTransition(paneId, prev?.state ?? null, status.state, {
        focused: Boolean(pane?.focused),
        elapsed: prev?.lastElapsed ?? null,
        agentName: status.agentName,
        model: status.model,
      });
    } else {
      // 保持 reportedState 不变 —— 下一轮会再试一次。
      log(paneId, `上报 ${status.state} 失败，下轮重试`);
    }
  }

  const tokens = buildTokens(status);
  const key = tokensKey(tokens);
  const displayAgent = formatDisplayAgent(status);
  const now = Date.now();
  let metaAt = prev?.metaAt ?? 0;
  if (metadataNeedsReport(prev, { tokensKey: key, displayAgent, now, refreshMs: META_REFRESH_MS })) {
    metaAt = now;
    reportMetadata(paneId, {
      displayAgent,
      tokens,
      stateLabels: buildStateLabels(status),
      ttlMs: META_TTL_MS,
    });
  }

  tracked.set(paneId, {
    // 记的是**herdr 侧当前认为的状态**，不是我们解析出的状态。上报失败时两者不同，
    // 这个差异正是下一轮重发的触发条件。
    state: reportedState,
    sessionId: status.sessionId ?? prev?.sessionId ?? null,
    tokensKey: key,
    displayAgent,
    metaAt,
    // run 结束后 busy 行就没了，所以只在还在跑的时候记；停下来时保留最后读数，
    // 供"跑完了"那条通知报用时。
    lastElapsed: status.busy ? status.elapsed : (prev?.lastElapsed ?? null),
  });
}

// 两档节奏：已接管的 pane 每轮都读（状态要跟手），未知 pane 只在发现轮里做
// process-info 探测。全量探测每轮一次的话，17 个 pane 就是每秒十几次子进程 spawn，
// 纯浪费 —— 新的 OpenClaw 会话晚几秒被发现完全可以接受。
let lastDiscovery = 0;

function discover(panes) {
  const found = [];
  for (const pane of panes) {
    const paneId = pane.pane_id;
    if (!paneId || tracked.has(paneId)) continue;
    // 已被别的 source 认领的 pane 不碰 —— 那是 claude/codex 的地盘。
    if (pane.agent && pane.agent !== AGENT_LABEL) continue;
    if (isOpenClawPane(paneId, pane)) found.push(paneId);
  }
  return found;
}

function tick() {
  const panes = listPanes();
  if (!panes.length) return; // herdr 没跑或还没起来，下一轮再说
  const byId = new Map(panes.map((p) => [p.pane_id, p]));

  const now = Date.now();
  if (now - lastDiscovery >= DISCOVERY_MS) {
    lastDiscovery = now;
    for (const paneId of discover(panes)) {
      log(paneId, "discovered");
      // state 置 null 而不是某个具体值：decideNotification 靠 prev==null 认出
      // "首次观测"，从而不给刚接管的面板补发一堆过期通知。
      tracked.set(paneId, { state: null, sessionId: null, tokensKey: "", lastElapsed: null });
    }
  }

  for (const paneId of [...tracked.keys()]) {
    // pane 没了，或前台已经不是 OpenClaw（用户退出 TUI 回到 shell）—— 交还 authority，
    // 别占着让 herdr 以为还有 agent 在跑。
    if (!byId.has(paneId) || !isOpenClawPane(paneId, byId.get(paneId))) {
      releaseAgent(paneId);
      tracked.delete(paneId);
      log(paneId, "released");
      continue;
    }
    syncPane(paneId, byId.get(paneId));
  }
}

function shutdown() {
  for (const paneId of tracked.keys()) releaseAgent(paneId);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

tick();
if (!ONCE) setInterval(tick, POLL_MS);
