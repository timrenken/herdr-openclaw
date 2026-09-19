import assert from "node:assert/strict";
import { test } from "node:test";

import { parseOpenClawStatus } from "../lib/detect.mjs";
import { formatDisplayAgent } from "../lib/identity.mjs";

test("formats each parsed footer identity as display name plus agent id", () => {
  const main = parseOpenClawStatus(
    "connected | idle\nagent main (Lumen) | session\ntui-main | gpt-5.6-terra low | deliver:off | tokens 1k/2k (50%)\n",
  );
  assert.equal(formatDisplayAgent(main), "Lumen (main)");

  const amelia = parseOpenClawStatus("connected | idle\nagent amelia (amelia) | session tui-amelia\n");
  assert.equal(formatDisplayAgent(amelia), "amelia (amelia)");
  assert.equal(formatDisplayAgent("main (Lumen)"), "Lumen (main)");
});

test("keeps a bare identity useful and falls back only when identity is missing", () => {
  const tony = parseOpenClawStatus("connected | idle\nagent tony | session tui-tony\n");
  assert.equal(formatDisplayAgent(tony), "tony (tony)");
  assert.equal(formatDisplayAgent({}), "OpenClaw");
  assert.equal(formatDisplayAgent({ agentName: "  " }), "OpenClaw");
});
