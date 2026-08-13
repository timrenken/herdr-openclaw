// 极小的 argv 拆解。手写而不是引依赖：本仓库零依赖，需求也只有
// "布尔 flag + 带值选项 + 位置参数"三种。
//
// 存在的理由是之前 bin/read.mjs 里那段 inline 解析会把带值选项的**值**
// 误当成位置参数（`--lines 60` 的 60 会被当 pane_id），这种 bug 不该靠小心避免。

/**
 * @param {string[]} argv 已去掉 node 与脚本名
 * @param {string[]} valued 需要吃掉下一个参数当值的选项名（不带 --）
 */
export function parseArgs(argv, valued = []) {
  const wanted = new Set(valued);
  const flags = new Set();
  const opts = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (wanted.has(name)) {
      opts[name] = argv[i + 1];
      i += 1; // 值已消费，不能再当位置参数
      continue;
    }
    flags.add(a);
  }
  return { flags, opts, positional };
}
