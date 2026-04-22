/**
 * M3 - 从零实现最小有限状态机（FSM）
 *
 * 核心概念：
 * - State：当前所处的阶段
 * - Event：触发状态转换的事件
 * - Transition：从一个状态到另一个状态的规则
 *
 * 这是 harness 执行流的骨架
 */

// ---- 类型定义 ----

type State =
  | "IDLE"
  | "PLANNING"
  | "EXECUTING"
  | "VERIFYING"
  | "RETRYING"
  | "DONE"
  | "FAILED";

type FsmEvent =
  | "START"
  | "PLAN_COMPLETE"
  | "STEP_COMPLETE"
  | "VERIFY_PASS"
  | "VERIFY_FAIL"
  | "RETRY_EXHAUSTED"
  | "RESET";

// 转换表：[当前状态 + 事件] → 下一个状态
type TransitionTable = Partial<Record<State, Partial<Record<FsmEvent, State>>>>;

const TRANSITIONS: TransitionTable = {
  IDLE: {
    START: "PLANNING",
  },
  PLANNING: {
    PLAN_COMPLETE: "EXECUTING",
  },
  EXECUTING: {
    STEP_COMPLETE: "VERIFYING",
  },
  VERIFYING: {
    VERIFY_PASS: "DONE",
    VERIFY_FAIL: "RETRYING",
  },
  RETRYING: {
    STEP_COMPLETE: "VERIFYING", // 重试后再次验证
    RETRY_EXHAUSTED: "FAILED",
  },
  DONE: {
    RESET: "IDLE",
  },
  FAILED: {
    RESET: "IDLE",
  },
};

// ---- FSM 实现 ----

class StateMachine {
  private state: State = "IDLE";
  private history: Array<{ from: State; event: FsmEvent; to: State; timestamp: Date }> = [];

  constructor(private transitions: TransitionTable) {}

  getState(): State {
    return this.state;
  }

  // 尝试触发一个事件，返回是否成功转换
  send(event: FsmEvent): boolean {
    const nextState = this.transitions[this.state]?.[event];

    if (!nextState) {
      console.log(`  ⚠️  Invalid transition: ${this.state} + ${event} (ignored)`);
      return false;
    }

    const from = this.state;
    this.state = nextState;
    this.history.push({ from, event, to: nextState, timestamp: new Date() });

    console.log(`  [FSM] ${from} --[${event}]--> ${nextState}`);
    return true;
  }

  isTerminal(): boolean {
    return this.state === "DONE" || this.state === "FAILED";
  }

  getHistory() {
    return this.history;
  }
}

// ---- 演示 ----

async function simulateHarnessRun(shouldFail: boolean = false) {
  const fsm = new StateMachine(TRANSITIONS);
  let retryCount = 0;
  const MAX_RETRIES = 3;

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Simulating harness run (fail=${shouldFail})`);
  console.log(`${"=".repeat(40)}`);

  // 基于当前状态分发处理逻辑（而非线性数组）
  let loopCount = 0;
  while (!fsm.isTerminal()) {
    loopCount++;
    if (loopCount > 20) { console.log("  ⚠️  Safety limit reached"); break; }

    switch (fsm.getState()) {
      case "IDLE":
        console.log("\n[PLANNING] Analyzing task and generating plan...");
        await sleep(100);
        fsm.send("START");
        await sleep(200);
        fsm.send("PLAN_COMPLETE");
        break;

      case "EXECUTING":
        console.log("\n[EXECUTING] Running plan steps...");
        await sleep(300);
        fsm.send("STEP_COMPLETE");
        break;

      case "VERIFYING":
        console.log("\n[VERIFYING] Running tsc and tests...");
        await sleep(200);
        if (shouldFail && retryCount < 2) {
          console.log("  tsc: FAILED (type error on line 42)");
          fsm.send("VERIFY_FAIL");
        } else {
          console.log("  tsc: PASSED");
          console.log("  tests: PASSED (5/5)");
          fsm.send("VERIFY_PASS");
        }
        break;

      case "RETRYING":
        retryCount++;
        console.log(`\n[RETRYING] Attempt ${retryCount}/${MAX_RETRIES}...`);
        if (retryCount >= MAX_RETRIES) {
          console.log("  Max retries reached");
          fsm.send("RETRY_EXHAUSTED");
        } else {
          console.log("  Fixing the type error...");
          await sleep(300);
          fsm.send("STEP_COMPLETE"); // 回到 VERIFYING
        }
        break;
    }
  }

  console.log(`\n✅ Final state: ${fsm.getState()}`);
  console.log("\nExecution history:");
  fsm.getHistory().forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.from} --[${h.event}]--> ${h.to}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 运行两个场景
async function main() {
  await simulateHarnessRun(false); // 成功场景
  await simulateHarnessRun(true);  // 失败后重试场景
}

main().catch(console.error);

/**
 * 关键观察：
 * 1. 状态机让"下一步做什么"变成了查表，而不是复杂的 if-else
 * 2. 任何时刻你都知道 harness 在哪个阶段（getState()）
 * 3. 非法的状态转换被静默忽略，不会导致崩溃
 * 4. history 让整个执行过程可追溯
 */
