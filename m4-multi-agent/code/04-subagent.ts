/**
 * M4 - Subagent
 *
 * 核心概念：
 * - Subagent 只知道自己的任务，不知道全局
 * - 有自己独立的状态机和 context
 * - 完成后输出结构化结果给 orchestrator
 */

import * as fs from "fs";
import * as path from "path";

// ---- Subagent 的任务输入 ----

interface SubagentTask {
  id: string;
  description: string;
  inputs: Record<string, string>;
  outputFiles: string[];
  workDir: string; // 隔离的工作目录
}

// ---- Subagent 内部状态机 ----

type SubagentState = "IDLE" | "READING_INPUTS" | "GENERATING" | "WRITING" | "DONE" | "FAILED";

// ---- Mock LLM（模拟代码生成）----

class MockCodeGenerator {
  async generate(task: SubagentTask): Promise<string> {
    await sleep(150);
    return `/**
 * Auto-generated for: ${task.description}
 * Task ID: ${task.id}
 */

export function ${task.id.replace(/-/g, "_")}(input: unknown): unknown {
  // TODO: implement ${task.description}
  throw new Error("Not implemented");
}
`;
  }
}

// ---- Subagent 实现 ----

class Subagent {
  private state: SubagentState = "IDLE";
  private log: string[] = [];

  constructor(
    private task: SubagentTask,
    private llm: MockCodeGenerator
  ) {}

  private setState(s: SubagentState) {
    this.log.push(`${this.state} → ${s}`);
    this.state = s;
  }

  async run(): Promise<{ success: boolean; outputs: Record<string, string>; log: string[] }> {
    console.log(`\n  [Subagent:${this.task.id}] Starting`);

    try {
      // Phase 1: 读取所有输入
      this.setState("READING_INPUTS");
      const inputSummary = Object.entries(this.task.inputs)
        .map(([k, v]) => `${k}: ${v.slice(0, 50)}`)
        .join(", ");
      console.log(`  [Subagent:${this.task.id}] Inputs: ${inputSummary || "(none)"}`);

      // Phase 2: 生成代码
      this.setState("GENERATING");
      const generatedCode = await this.llm.generate(this.task);
      console.log(`  [Subagent:${this.task.id}] Generated ${generatedCode.length} chars`);

      // Phase 3: 写入输出文件
      this.setState("WRITING");
      const outputs: Record<string, string> = {};
      fs.mkdirSync(this.task.workDir, { recursive: true });

      for (const outputFile of this.task.outputFiles) {
        const fullPath = path.join(this.task.workDir, outputFile);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, generatedCode, "utf-8");
        outputs[outputFile] = generatedCode;
        console.log(`  [Subagent:${this.task.id}] Written: ${outputFile}`);
      }

      this.setState("DONE");
      return { success: true, outputs, log: this.log };

    } catch (e) {
      this.setState("FAILED");
      console.error(`  [Subagent:${this.task.id}] Error: ${(e as Error).message}`);
      return { success: false, outputs: {}, log: this.log };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Subagent Demo ===");

  const workDir = path.join(__dirname, "../../.tmp/subagent-demo");

  const tasks: SubagentTask[] = [
    {
      id: "auth-middleware",
      description: "JWT authentication middleware",
      inputs: { "user.interface.ts": "export interface User { id: string; email: string }" },
      outputFiles: ["src/auth/middleware.ts"],
      workDir,
    },
    {
      id: "user-routes",
      description: "User CRUD REST endpoints",
      inputs: { "user.interface.ts": "export interface User { id: string; email: string }" },
      outputFiles: ["src/routes/users.ts"],
      workDir,
    },
  ];

  const llm = new MockCodeGenerator();

  // 并行运行两个 subagent（各自独立，互不干扰）
  console.log("\nRunning 2 subagents in parallel...");
  const results = await Promise.all(
    tasks.map((task) => new Subagent(task, llm).run())
  );

  // 汇总
  console.log("\n--- Results ---");
  results.forEach((r, i) => {
    const icon = r.success ? "✅" : "❌";
    console.log(`${icon} ${tasks[i].id}: ${Object.keys(r.outputs).length} files, state log: ${r.log.join(" → ")}`);
  });

  // 清理
  fs.rmSync(workDir, { recursive: true, force: true });

  console.log("\n--- 关键观察 ---");
  console.log("1. 每个 subagent 有自己的状态机（READING → GENERATING → WRITING）");
  console.log("2. Subagent 只知道自己的 task，不知道其他 subagent 在做什么");
  console.log("3. workDir 隔离：每个 subagent 写到独立目录，不会互相覆盖");
  console.log("4. 失败时返回结构化错误，orchestrator 可以决定是否重试");
}

main().catch(console.error);
