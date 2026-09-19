const DEFAULT_DISPLAY_AGENT = "OpenClaw";

/**
 * Format the parsed OpenClaw footer identity for herdr's display-only label.
 * `agentName` is the stable OpenClaw agent id; `agentDisplayName` is the
 * optional human-facing name from `agent <id> (<name>)`.
 */
export function formatDisplayAgent(status = {}) {
  const source = typeof status === "string" ? { agentName: status } : status ?? {};
  const rawId = typeof source.agentName === "string" ? source.agentName.trim() : "";
  if (!rawId) return DEFAULT_DISPLAY_AGENT;

  // Accept the raw footer-shaped value too, so the helper remains useful at
  // the boundary even when a caller has not run the parser first.
  const inline = rawId.match(/^(.+?)\s*\(([^()]*)\)$/);
  const id = inline?.[1]?.trim() || rawId;

  const name =
    (typeof source.agentDisplayName === "string" ? source.agentDisplayName.trim() : "") ||
    inline?.[2]?.trim() ||
    "";
  return `${name || id} (${id})`;
}
