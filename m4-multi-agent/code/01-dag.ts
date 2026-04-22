/**
 * M4 - DAG（有向无环图）任务调度
 *
 * 核心概念：
 * - 把一个大任务分解为有依赖关系的小任务
 * - 找出可以并行执行的任务（没有未完成依赖的任务）
 * - 按依赖顺序执行，最大化并行度
 */

// ---- 类型定义 ----

interface Task {
  id: string;
  description: string;
  dependencies: string[]; // 必须先完成的任务 ID
  status: "pending" | "running" | "done" | "failed";
  result?: string;
}

// ---- DAG 调度器 ----

class DAGScheduler {
  private tasks: Map<string, Task>;

  constructor(tasks: Task[]) {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
    this.validate();
  }

  // 验证：检查是否有循环依赖
  private validate() {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      inStack.add(id);

      const task = this.tasks.get(id)!;
      for (const dep of task.dependencies) {
        if (!this.tasks.has(dep)) {
          throw new Error(`Task "${id}" depends on unknown task "${dep}"`);
        }
        if (hasCycle(dep)) return true;
      }

      inStack.delete(id);
      return false;
    };

    for (const id of this.tasks.keys()) {
      if (hasCycle(id)) {
        throw new Error(`Circular dependency detected involving task "${id}"`);
      }
    }
  }

  // 获取当前可以执行的任务（所有依赖都已完成）
  getReadyTasks(): Task[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (task.status !== "pending") return false;
      return task.dependencies.every(
        (depId) => this.tasks.get(depId)?.status === "done"
      );
    });
  }

  markRunning(id: string) {
    const task = this.tasks.get(id);
    if (task) task.status = "running";
  }

  markDone(id: string, result: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "done";
      task.result = result;
    }
  }

  markFailed(id: string) {
    const task = this.tasks.get(id);
    if (task) task.status = "failed";
  }

  isComplete(): boolean {
    return Array.from(this.tasks.values()).every(
      (t) => t.status === "done" || t.status === "failed"
    );
  }

  getResult(): Map<string, string> {
    const results = new Map<string, string>();
    for (const [id, task] of this.tasks) {
      if (task.result) results.set(id, task.result);
    }
    return results;
  }

  printStatus() {
    console.log("\n--- Task Status ---");
    for (const task of this.tasks.values()) {
      const icon =
        task.status === "done"
          ? "✅"
          : task.status === "running"
          ? "🔄"
          : task.status === "failed"
          ? "❌"
          : "⏳";
      console.log(`  ${icon} [${task.id}] ${task.description}`);
    }
  }
}

// ---- 模拟执行器 ----

async function simulateTask(task: Task): Promise<string> {
  const duration = 200 + Math.random() * 300; // 模拟不同的执行时间
  await sleep(duration);
  return `Result of ${task.id}: completed in ${duration.toFixed(0)}ms`;
}

// ---- 并行调度执行 ----

async function executeDAG(scheduler: DAGScheduler): Promise<void> {
  console.log("\n🚀 Starting DAG execution");
  const startTime = Date.now();

  while (!scheduler.isComplete()) {
    const readyTasks = scheduler.getReadyTasks();

    if (readyTasks.length === 0) {
      // 没有可执行的任务但还没完成——说明有任务在运行中
      await sleep(50);
      continue;
    }

    console.log(
      `\n[Scheduler] ${readyTasks.length} tasks ready to run in parallel: ${readyTasks.map((t) => t.id).join(", ")}`
    );

    // 并行执行所有就绪任务
    readyTasks.forEach((task) => scheduler.markRunning(task.id));

    await Promise.all(
      readyTasks.map(async (task) => {
        console.log(`  → Starting: ${task.id}`);
        try {
          const result = await simulateTask(task);
          scheduler.markDone(task.id, result);
          console.log(`  ✅ Done: ${task.id}`);
        } catch (e) {
          scheduler.markFailed(task.id);
          console.log(`  ❌ Failed: ${task.id}`);
        }
      })
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n✅ DAG complete in ${elapsed}ms`);
  scheduler.printStatus();
}

// ---- 演示：PRD → 代码的任务 DAG ----

const prdTasks: Task[] = [
  {
    id: "parse_prd",
    description: "Parse PRD and extract requirements",
    dependencies: [],
    status: "pending",
  },
  {
    id: "design_api",
    description: "Design REST API endpoints",
    dependencies: ["parse_prd"],
    status: "pending",
  },
  {
    id: "design_schema",
    description: "Design database schema",
    dependencies: ["parse_prd"],
    status: "pending",
  },
  {
    id: "impl_routes",
    description: "Implement API route handlers",
    dependencies: ["design_api"],
    status: "pending",
  },
  {
    id: "impl_models",
    description: "Implement data models",
    dependencies: ["design_schema"],
    status: "pending",
  },
  {
    id: "write_tests",
    description: "Write integration tests",
    dependencies: ["impl_routes", "impl_models"],
    status: "pending",
  },
  {
    id: "integrate",
    description: "Integration and final verification",
    dependencies: ["write_tests"],
    status: "pending",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("PRD → Code DAG execution demo");
  console.log("Tasks:", prdTasks.map((t) => `${t.id}(deps: [${t.dependencies}])`).join(", "));

  const scheduler = new DAGScheduler(prdTasks);
  await executeDAG(scheduler);
}

main().catch(console.error);

/**
 * 关键观察：
 * 1. design_api 和 design_schema 可以并行（都只依赖 parse_prd）
 * 2. impl_routes 和 impl_models 也可以并行
 * 3. 串行执行需要 7 步，DAG 调度只需要 4 轮（大幅减少总时间）
 * 4. 任何一个任务失败，只影响依赖它的下游任务
 */
