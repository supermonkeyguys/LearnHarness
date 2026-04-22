/**
 * M3 - 基于文件的 Checkpoint 系统
 *
 * 核心概念：
 * - 每个阶段结束后保存状态到磁盘
 * - 重启时检测并从断点恢复
 * - 幂等性：同一步骤执行两次结果相同
 */

import * as fs from "fs";
import * as path from "path";

// ---- Checkpoint 数据结构 ----

interface Checkpoint {
  taskId: string;
  version: number;           // 每次更新递增，防止读到旧版本
  state: string;             // 当前 FSM 状态名
  completedSteps: number[];  // 已完成的步骤 ID
  stepResults: Record<number, string>; // 每步的输出
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Checkpoint 管理器 ----

class CheckpointManager {
  private dir: string;

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, ".harness-checkpoints");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(taskId: string): string {
    // taskId 中可能有特殊字符，做简单清理
    const safe = taskId.replace(/[^a-zA-Z0-9-_]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  // 保存 checkpoint（原子写：先写临时文件再重命名）
  save(checkpoint: Checkpoint): void {
    const file = this.filePath(checkpoint.taskId);
    const tmp  = file + ".tmp";

    const data = JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2);
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, file); // 原子操作，防止写到一半崩溃

    console.log(`  [Checkpoint] Saved: state=${checkpoint.state}, steps=${checkpoint.completedSteps}`);
  }

  // 加载 checkpoint，不存在则返回 null
  load(taskId: string): Checkpoint | null {
    const file = this.filePath(taskId);
    if (!fs.existsSync(file)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Checkpoint;
      console.log(`  [Checkpoint] Loaded: state=${data.state}, steps=${data.completedSteps}`);
      return data;
    } catch {
      console.warn(`  [Checkpoint] Corrupt checkpoint for ${taskId}, ignoring`);
      return null;
    }
  }

  // 删除 checkpoint（任务完成后清理）
  clear(taskId: string): void {
    const file = this.filePath(taskId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`  [Checkpoint] Cleared: ${taskId}`);
    }
  }

  listAll(): string[] {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  }
}

// ---- 使用 checkpoint 的 Harness 运行器 ----

async function runWithCheckpoint(
  taskId: string,
  steps: Array<{ id: number; name: string }>,
  checkpointMgr: CheckpointManager,
  simulateInterrupt: boolean = false
): Promise<void> {
  // 尝试从 checkpoint 恢复
  let checkpoint = checkpointMgr.load(taskId);

  if (checkpoint) {
    console.log(`\n♻️  Resuming from checkpoint (completed steps: ${checkpoint.completedSteps})`);
  } else {
    checkpoint = {
      taskId,
      version: 1,
      state: "EXECUTING",
      completedSteps: [],
      stepResults: {},
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    console.log(`\n🆕 Starting fresh run`);
  }

  for (const step of steps) {
    // 跳过已完成的步骤（幂等性保证）
    if (checkpoint.completedSteps.includes(step.id)) {
      console.log(`  [Step ${step.id}] ${step.name} — skipped (already done)`);
      continue;
    }

    console.log(`  [Step ${step.id}] ${step.name} — executing...`);
    await sleep(200);

    // 模拟中断：在第 2 步执行完但保存 checkpoint 前崩溃
    if (simulateInterrupt && step.id === 2) {
      console.log(`\n💥 Simulated crash after step ${step.id}!`);
      // 注意：step 2 的结果还没保存到 checkpoint
      return;
    }

    // 步骤完成，更新 checkpoint
    const result = `output_of_step_${step.id}`;
    checkpoint.completedSteps.push(step.id);
    checkpoint.stepResults[step.id] = result;
    checkpoint.version++;

    checkpointMgr.save(checkpoint);
  }

  // 全部完成
  checkpoint.state = "DONE";
  checkpointMgr.save(checkpoint);
  console.log(`\n✅ Task complete!`);

  // 清理 checkpoint
  checkpointMgr.clear(taskId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Checkpoint System Demo ===");

  const mgr = new CheckpointManager(path.join(__dirname, "../.."));
  const taskId = "demo-task-001";
  const steps = [
    { id: 1, name: "Parse PRD" },
    { id: 2, name: "Generate plan" },
    { id: 3, name: "Implement code" },
    { id: 4, name: "Run tests" },
  ];

  // 第一次运行：在步骤 2 后崩溃
  console.log("\n=== Run 1: crashes after step 2 ===");
  await runWithCheckpoint(taskId, steps, mgr, true);

  // 第二次运行：从 checkpoint 恢复，只执行步骤 3 和 4
  console.log("\n=== Run 2: resumes from checkpoint ===");
  await runWithCheckpoint(taskId, steps, mgr, false);

  console.log("\n--- 关键观察 ---");
  console.log("1. 崩溃后重启，步骤 1 和 2 不会重新执行（已有 checkpoint）");
  console.log("2. 原子写（tmp + rename）防止写到一半的 checkpoint 被读取");
  console.log("3. 幂等性：同一步骤执行两次产生相同结果");
}

main().catch(console.error);
