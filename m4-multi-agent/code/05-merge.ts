/**
 * M4 - 结果合并
 *
 * 核心概念：
 * - 多个 subagent 的输出可能修改同一文件
 * - 合并策略：追加 / 替换 / 冲突标记 / 智能合并
 * - 合并后需要重新验证
 */

// ---- 合并输入 ----

interface SubagentOutput {
  agentId: string;
  files: Record<string, string>; // 文件路径 → 内容
}

// ---- 合并策略 ----

type MergeStrategy =
  | "last-wins"       // 后来的覆盖前面的（最简单）
  | "first-wins"      // 第一个写入的优先
  | "conflict-mark"   // 标记冲突，人工处理
  | "append";         // 追加内容（适合测试文件）

interface MergeResult {
  files: Record<string, string>;
  conflicts: Array<{ file: string; agents: string[] }>;
  stats: { totalFiles: number; conflictCount: number; mergedCount: number };
}

// ---- 合并引擎 ----

class MergeEngine {
  merge(outputs: SubagentOutput[], strategy: MergeStrategy = "conflict-mark"): MergeResult {
    const fileOwners = new Map<string, string[]>(); // 文件 → 写过它的 agent 列表
    const fileContents = new Map<string, string[]>(); // 文件 → 各 agent 的内容

    // 收集所有文件的所有版本
    for (const output of outputs) {
      for (const [file, content] of Object.entries(output.files)) {
        if (!fileOwners.has(file)) {
          fileOwners.set(file, []);
          fileContents.set(file, []);
        }
        fileOwners.get(file)!.push(output.agentId);
        fileContents.get(file)!.push(content);
      }
    }

    const mergedFiles: Record<string, string> = {};
    const conflicts: MergeResult["conflicts"] = [];

    for (const [file, owners] of fileOwners) {
      const versions = fileContents.get(file)!;

      if (owners.length === 1) {
        // 无冲突：只有一个 agent 写了这个文件
        mergedFiles[file] = versions[0];
        continue;
      }

      // 有冲突：多个 agent 写了同一文件
      conflicts.push({ file, agents: owners });

      switch (strategy) {
        case "last-wins":
          mergedFiles[file] = versions[versions.length - 1];
          break;

        case "first-wins":
          mergedFiles[file] = versions[0];
          break;

        case "append":
          mergedFiles[file] = versions.join("\n\n// --- next agent ---\n\n");
          break;

        case "conflict-mark":
        default:
          // Git-style 冲突标记
          mergedFiles[file] = versions.map((v, i) =>
            `<<<<<<< ${owners[i]}\n${v}\n>>>>>>>`
          ).join("\n=======\n");
          break;
      }
    }

    return {
      files: mergedFiles,
      conflicts,
      stats: {
        totalFiles: fileOwners.size,
        conflictCount: conflicts.length,
        mergedCount: fileOwners.size - conflicts.length,
      },
    };
  }
}

// ---- 演示 ----

function main() {
  console.log("=== Merge Engine Demo ===\n");

  const outputs: SubagentOutput[] = [
    {
      agentId: "impl-agent",
      files: {
        "src/auth.ts":   "export function login(user: string) { return 'token'; }",
        "src/utils.ts":  "export function hash(s: string) { return s; }",
        "src/config.ts": "export const PORT = 3000;",
      },
    },
    {
      agentId: "test-agent",
      files: {
        "tests/auth.test.ts": "describe('auth', () => { it('works', () => {}) })",
        "src/utils.ts":       "export function hash(s: string) { return btoa(s); }", // 冲突！
      },
    },
    {
      agentId: "docs-agent",
      files: {
        "README.md":     "# Auth Service\nAuthentication module.",
        "src/config.ts": "export const PORT = 8080; // docs agent changed port", // 冲突！
      },
    },
  ];

  const engine = new MergeEngine();
  const strategies: MergeStrategy[] = ["last-wins", "first-wins", "conflict-mark", "append"];

  for (const strategy of strategies) {
    const result = engine.merge(outputs, strategy);
    console.log(`\n--- Strategy: ${strategy} ---`);
    console.log(`  Files: ${result.stats.totalFiles} total, ${result.stats.conflictCount} conflicts`);

    if (result.conflicts.length > 0) {
      result.conflicts.forEach((c) => {
        console.log(`  ⚠️  Conflict in "${c.file}" — written by: ${c.agents.join(", ")}`);
        // 显示合并结果的前 100 字符
        const merged = result.files[c.file];
        console.log(`     Result preview: ${merged.slice(0, 100).replace(/\n/g, "↵")}...`);
      });
    }
  }

  console.log("\n--- 关键观察 ---");
  console.log("1. 'conflict-mark' 最安全：保留所有版本，让人工或后续 agent 决策");
  console.log("2. 'last-wins' 最简单，但会静默丢失数据");
  console.log("3. 'append' 适合测试文件（多个 agent 的测试可以共存）");
  console.log("4. 合并后必须重新运行质量门控（tsc / tests）验证结果");
}

main();
