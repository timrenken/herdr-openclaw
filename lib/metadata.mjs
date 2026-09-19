/**
 * Decide whether a pane's display metadata needs to be sent to Herdr.
 *
 * Token data is often absent from a just-rendered or narrow OpenClaw footer,
 * but its agent identity is still useful. Keep that identity in the change
 * key so an empty token payload cannot suppress the initial metadata report.
 */
export function metadataNeedsReport(prev, { tokensKey, displayAgent, now, refreshMs }) {
  return (
    tokensKey !== prev?.tokensKey ||
    displayAgent !== prev?.displayAgent ||
    now - (prev?.metaAt ?? 0) >= refreshMs
  );
}
