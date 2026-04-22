/**
 * M3 - Harness 标准状态定义与转换规则
 *
 * 在 01-fsm.ts 的通用 FSM 基础上，定义 harness 专用的：
 * - 五个标准状态的语义
 * - 每个状态的进入/退出条件
 * - 状态携带的数据（context）
 */

import * as fs from "fs";
import * as path from "path";

// ---- Harness 状态定义 ----

type HarnessState =
  | { name: "IDLE" }
  | { name: "PLANNING";  taskDescription: string }
  | { name: "EXECUTING"; plan: Step[]; currentStepIndex: number }
  | { name: "VERIFYING"; stepResult: string }
  | { name: "RETRYING";  failureReason: string; retryCount: number }
  | { name: "DONE";      output: string }
  | { name: "FAILED";    reason: string };

interface Step {
  id: number;
  description: string;
  status: "pending" | "done" | "failed";
}

// ---- 进入/退出条件文档 ----

const STATE_CONTRACTS = {
  IDLE: {
    enterCondition: "Initial state or after reset",
    exitCondition:  "A task is submitted",
    invariant:      "No active work in progress",
  },
  PLANNING: {
    enterCondition: "Task submitted, no plan exists yet",
    exitCondition:  "Plan generated with ≥1 steps",
    invariant:      "taskDescription is non-empty",
  },
  EXECUTING: {
    enterCondition: "Valid plan exists, current step is pending",
    exitCondition:  "Current step produces a result (success or failure)",
    invariant:      "currentStepIndex < plan.length",
  },
  VERIFYING: {
    enterCondition: "Step execution produced output",
    exitCondition:  "Verification command exits with 0 (pass) or non-0 (fail)",
    invariant:      "stepResult is non-empty",
  },
  RETRYING: {
    enterCondition: "Verification failed",
    exitCondition:  "retryCount < MAX_RETRIES → re-execute; else → FAILED",
    invariant:      "retryCount ≥ 1",
  },
  DONE: {
    enterCondition: "All steps verified successfully",
    exitCondition:  "Terminal state — only RESET event can leave",
    invariant:      "output contains final result",
  },
  FAILED: {
    enterCondition: "Max retries exhausted OR unrecoverable error",
    exitCondition:  "Terminal state — only RESET event can leave",
    invariant:      "reason explains why it failed",
  },
};

// ---- Harness 状态机 ----

const MAX_RETRIES = 3;

class HarnessStateMachine {
  private state: HarnessState = { name: "IDLE" };
  private log: string[] = [];

  getState() { return this.state; }

  private transition(next: HarnessState) {
    const entry = `${this.state.name} → ${next.name}`;
    this.log.push(entry);
    console.log(`  [FSM] ${entry}`);
    this.state = next;
  }

  // ---- 事件处理器（每个方法对应一个状态转换）----

  submitTask(description: string) {
    if (this.state.name !== "IDLE") throw new Error(`Cannot submit task in state: ${this.state.name}`);
    this.transition({ name: "PLANNING", taskDescription: description });
  }

  planComplete(steps: Omit<Step, "status">[]) {
    if (this.state.name !== "PLANNING") throw new Error(`Cannot complete plan in state: ${this.state.name}`);
    this.transition({
      name: "EXECUTING",
      plan: steps.map((s) => ({ ...s, status: "pending" as const })),
      currentStepIndex: 0,
    });
  }

  stepComplete(result: string) {
    if (this.state.name !== "EXECUTING" && this.state.name !== "RETRYING") {
      throw new Error(`Cannot complete step in state: ${this.state.name}`);
    }
    this.transition({ name: "VERIFYING", stepResult: result });
  }

  verifyPass() {
    if (this.state.name !== "VERIFYING") throw new Error(`Cannot verify in state: ${this.state.name}`);
    const prev = this.state as Extract<HarnessState, { name: "VERIFYING" }>;

    // 检查是否还有更多步骤
    // （简化：这里直接进入 DONE，完整实现会检查 plan 进度）
    this.transition({ name: "DONE", output: prev.stepResult });
  }

  verifyFail(reason: string) {
    if (this.state.name !== "VERIFYING") throw new Error(`Cannot fail verify in state: ${this.state.name}`);
    this.transition({ name: "RETRYING", failureReason: reason, retryCount: 1 });
  }

  retry() {
    if (this.state.name !== "RETRYING") throw new Error(`Cannot retry in state: ${this.state.name}`);
    const s = this.state as Extract<HarnessState, { name: "RETRYING" }>;

    if (s.retryCount >= MAX_RETRIES) {
      this.transition({ name: "FAILED", reason: `Max retries (${MAX_RETRIES}) exhausted. Last failure: ${s.failureReason}` });
    } else {
      // 增加重试计数，回到类 EXECUTING 状态（简化为直接 stepComplete 触发）
      this.state = { ...s, retryCount: s.retryCount + 1 };
      console.log(`  [FSM] RETRYING (attempt ${s.retryCount + 1}/${MAX_RETRIES})`);
    }
  }

  reset() {
    if (this.state.name !== "DONE" && this.state.name !== "FAILED") {
      throw new Error(`Cannot reset from state: ${this.state.name}`);
    }
    this.transition({ name: "IDLE" });
  }

  isTerminal() {
    return this.state.name === "DONE" || this.state.name === "FAILED";
  }

  printLog() {
    console.log("\nTransition log:");
    this.log.forEach((entry, i) => console.log(`  ${i + 1}. ${entry}`));
  }
}

// ---- 演示：展示状态携带的数据 ----

async function demo() {
  console.log("=== Harness States Demo ===\n");

  // 打印状态契约
  console.log("State contracts:");
  for (const [state, contract] of Object.entries(STATE_CONTRACTS)) {
    console.log(`\n  ${state}:`);
    console.log(`    Enter: ${contract.enterCondition}`);
    console.log(`    Exit:  ${contract.exitCondition}`);
  }

  // 模拟一次成功的运行
  console.log("\n\n--- Simulation: successful run ---");
  const fsm = new HarnessStateMachine();

  console.log(`Initial state: ${JSON.stringify(fsm.getState())}`);

  fsm.submitTask("Implement user login endpoint");
  console.log(`After submitTask: ${JSON.stringify(fsm.getState())}`);

  fsm.planComplete([
    { id: 1, description: "Write route handler" },
    { id: 2, description: "Write tests" },
  ]);
  console.log(`After planComplete: ${JSON.stringify(fsm.getState())}`);

  fsm.stepComplete("export function loginHandler() { ... }");
  fsm.verifyPass();
  console.log(`After verifyPass: ${JSON.stringify(fsm.getState())}`);

  fsm.printLog();

  // 保存状态契约到文件（演示状态可序列化）
  const contractPath = path.join(__dirname, "../concepts/state-contracts.json");
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(contractPath, JSON.stringify(STATE_CONTRACTS, null, 2));
  console.log(`\n✅ State contracts saved to: ${contractPath}`);
}

demo().catch(console.error);
