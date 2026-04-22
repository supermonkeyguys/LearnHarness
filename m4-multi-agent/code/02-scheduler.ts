/**
 * M4 - 任务调度器
 *
 * 在 01-dag.ts 的 DAG 基础上，实现真正的并发调度：
 * - 同时维护「运行中」的任务集合
 * - 任务完成后立即调度新的就绪任务
 * - 支持最大并发数限制
 */

// ---- 任务定义 ----

interface Task {
  id: string;
  description: string;
  dependencies: string[];
  durationMs: number; // 模拟执行时间
}

type TaskStatus = "pending" | "running" | "done" | "failed";

// ---- 调度器 ----

class Scheduler {
  private status = new Map<string, TaskStatus>();
  private results = new Map<string, string>();
  private tasks: Map<string, Task>;

  constructor(tasks: Task[], private maxConcurrent: number = 4) {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
    tasks.forEach((t) => this.status.set(t.id, "pending"));
  }

  private getReady(): Task[] {
    return Array.from(this.tasks.values()).filter((t) => {
      if (this.status.get(t.id) !== "pending") return false;
      return t.dependencies.every((d) => this.status.get(d) === "done");
    });
  }

  private getRunning(): string[] {
    return Array.from(this.status.entries())
      .filter(([, s]) => s === "running")
      .map(([id]) => id);
  }

  async run(executor: (task: Task) => Promise<string>): Promise<Map<string, string>> {
    const start = Date.now();
    console.log(`\n🚀 Scheduler started (maxConcurrent=${this.maxConcurrent})`);

    // 使用 Promise 池：同时最多 maxConcurrent 个任务在跑
    const running = new Set<Promise<void>>();

    const tryDispatch = () => {
      while (running.size < this.maxConcurrent) {
        const ready = this.getReady();
        const toStart = ready.slice(0, this.maxConcurrent - running.size);
        if (toStart.length === 0) break;

        for (const task of toStart) {
          this.status.set(task.id, "running");
          console.log(`  → [${task.id}] started (running: ${this.getRunning().length}/${this.maxConcurrent})`);

          const p = executor(task)
            .then((result) => {
              this.status.set(task.id, "done");
              this.results.set(task.id, result);
              console.log(`  ✅ [${task.id}] done`);
            })
            .catch((err: Error) => {
              this.status.set(task.id, "failed");
              console.log(`  ❌ [${task.id}] failed: ${err.message}`);
            })
            .finally(() => {
              running.delete(p);
              tryDispatch(); // 有任务完成，立即尝试调度新任务
            });

          running.add(p);
        }
      }
    };

    tryDispatch();

    // 等待所有任务完成
    while (running.size > 0 || this.getReady().length > 0) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const elapsed = Date.now() - start;
    const done = Array.from(this.status.values()).filter((s) => s === "done").length;
    const failed = Array.from(this.status.values()).filter((s) => s === "failed").length;
    console.log(`\n✅ Scheduler complete in ${elapsed}ms — ${done} done, ${failed} failed`);

    return this.results;
  }
}

// ---- 演示 ----

async function main() {
  const tasks: Task[] = [
    { id: "A", description: "Parse input",         dependencies: [],        durationMs: 100 },
    { id: "B", description: "Fetch schema",         dependencies: ["A"],     durationMs: 300 },
    { id: "C", description: "Fetch config",         dependencies: ["A"],     durationMs: 200 },
    { id: "D", description: "Generate models",      dependencies: ["B"],     durationMs: 400 },
    { id: "E", description: "Generate routes",      dependencies: ["B","C"], durationMs: 350 },
    { id: "F", description: "Generate tests",       dependencies: ["D","E"], durationMs: 250 },
    { id: "G", description: "Bundle output",        dependencies: ["F"],     durationMs: 150 },
  ];

  console.log("=== Scheduler Demo ===");
  console.log("Task graph: A → B,C → D,E → F → G");
  console.log("(B and C parallel, D and E parallel)\n");

  // 对比：串行 vs 并行
  const serialTime = tasks.reduce((sum, t) => sum + t.durationMs, 0);
  console.log(`Serial execution would take: ~${serialTime}ms`);

  const scheduler = new Scheduler(tasks, 3); // 最多 3 个并发

  const results = await scheduler.run(async (task) => {
    await new Promise((r) => setTimeout(r, task.durationMs));
    return `result_of_${task.id}`;
  });

  console.log("\nResults:");
  results.forEach((v, k) => console.log(`  ${k}: ${v}`));
}

main().catch(console.error);
