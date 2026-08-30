import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

export function processCommand(pid) {
  if (!Number.isFinite(pid)) return "";
  if (isWindows) {
    const r = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Math.trunc(pid)}").CommandLine`,
    ], { encoding: "utf8", windowsHide: true });
    return (r.stdout ?? "").trim();
  }
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

export function isWatcherProcess(pid) {
  return /(?:^|[\\/])watch\.mjs(?:\s|$)/i.test(processCommand(pid));
}

export function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

export function terminateProcess(pid) {
  if (isWindows) {
    return spawnSync("taskkill.exe", ["/PID", String(Math.trunc(pid)), "/T", "/F"], {
      encoding: "utf8", windowsHide: true,
    }).status === 0;
  }
  try { process.kill(pid, "SIGTERM"); return true; } catch { return false; }
}
