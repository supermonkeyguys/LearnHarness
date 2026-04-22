export {};

/**
 * M7 - Hook 系统
 *
 * 核心概念：
 * - 在关键事件前后注入自定义逻辑
 * - 不修改核心代码就能扩展行为
 * - 用于：日志、安全检查、指标收集、人工介入
 */

// ---- 类型定义 ----

type HookEvent =
  | "before:tool_call"
  | "after:tool_call"
  | "before:llm_call"
  | "after:llm_call"
  | "on:state_change"
  | "on:error";

type HookContext = {
  "before:tool_call": { tool: string; args: Record<string, unknown> };
  "after:tool_call": { tool: string; args: Record<string, unknown>; result: string; durationMs: number };
  "before:llm_call": { model: string; messages: unknown[]; tokenEstimate: number };
  "after:llm_call": { model: string; tokensUsed: number; durationMs: number };
  "on:state_change": { from: string; to: string; event: string };
  "on:error": { error: Error; context: string };
};

type HookHandler<E extends HookEvent> = (
  ctx: HookContext[E]
) => Promise<void> | void;

// Hook 可以返回 false 来阻止操作继续
type BlockingHookHandler<E extends HookEvent> = (
  ctx: HookContext[E]
) => Promise<boolean | void> | boolean | void;

// ---- Hook 系统实现 ----

class HookSystem {
  private hooks: Map<HookEvent, BlockingHookHandler<HookEvent>[]> = new Map();
  private metrics = {
    toolCalls: 0,
    llmCalls: 0,
    totalTokens: 0,
    blockedOperations: 0,
  };

  on<E extends HookEvent>(event: E, handler: BlockingHookHandler<E>) {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(handler as BlockingHookHandler<HookEvent>);
    return this; // 支持链式调用
  }

  // 触发事件，如果任何 hook 返回 false，则阻止操作
  async emit<E extends HookEvent>(
    event: E,
    ctx: HookContext[E]
  ): Promise<boolean> {
    const handlers = this.hooks.get(event) ?? [];

    for (const handler of handlers) {
      const result = await handler(ctx as HookContext[HookEvent]);
      if (result === false) {
        this.metrics.blockedOperations++;
        return false; // 阻止操作
      }
    }

    return true; // 允许操作继续
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

// ---- 预置 Hooks ----

// 日志 hook：记录所有操作
function createLoggingHooks(hookSystem: HookSystem) {
  hookSystem
    .on("before:tool_call", ({ tool, args }) => {
      console.log(`  [LOG] → tool_call: ${tool}(${JSON.stringify(args)})`);
    })
    .on("after:tool_call", ({ tool, result, durationMs }) => {
      console.log(`  [LOG] ← tool_result: ${tool} (${durationMs}ms) = ${result.slice(0, 50)}`);
    })
    .on("on:state_change", ({ from, to, event }) => {
      console.log(`  [LOG] 🔄 state: ${from} --[${event}]--> ${to}`);
    })
    .on("on:error", ({ error, context }) => {
      console.error(`  [LOG] ❌ error in ${context}: ${error.message}`);
    });
}

// 安全 hook：危险操作需要确认
function createSafetyHooks(hookSystem: HookSystem) {
  const DANGEROUS_TOOLS = ["delete_file", "exec_command", "push_to_remote"];

  hookSystem.on("before:tool_call", async ({ tool, args }) => {
    if (DANGEROUS_TOOLS.includes(tool)) {
      // 在真实场景中，这里会暂停等待用户确认
      // 这里模拟自动拒绝（演示阻止机制）
      console.log(`  [SAFETY] ⚠️  Dangerous operation blocked: ${tool}(${JSON.stringify(args)})`);
      return false; // 阻止执行
    }
  });
}

// 指标 hook：收集性能数据
function createMetricsHooks(hookSystem: HookSystem) {
  const metrics = {
    toolCallCount: 0,
    totalToolDuration: 0,
    llmCallCount: 0,
    totalTokens: 0,
  };

  hookSystem
    .on("after:tool_call", ({ durationMs }) => {
      metrics.toolCallCount++;
      metrics.totalToolDuration += durationMs;
    })
    .on("after:llm_call", ({ tokensUsed }) => {
      metrics.llmCallCount++;
      metrics.totalTokens += tokensUsed;
    });

  return () => ({
    ...metrics,
    avgToolDuration:
      metrics.toolCallCount > 0
        ? metrics.totalToolDuration / metrics.toolCallCount
        : 0,
  });
}

// ---- 演示：带 hook 的工具执行器 ----

class InstrumentedExecutor {
  constructor(private hooks: HookSystem) {}

  async callTool(
    tool: string,
    args: Record<string, unknown>,
    executor: () => Promise<string>
  ): Promise<string | null> {
    // Pre-hook
    const allowed = await this.hooks.emit("before:tool_call", { tool, args });
    if (!allowed) {
      return null; // 被 hook 阻止
    }

    const start = Date.now();
    let result: string;

    try {
      result = await executor();
    } catch (e) {
      await this.hooks.emit("on:error", {
        error: e as Error,
        context: `tool:${tool}`,
      });
      throw e;
    }

    const durationMs = Date.now() - start;

    // Post-hook
    await this.hooks.emit("after:tool_call", { tool, args, result, durationMs });

    return result;
  }
}

// ---- 运行演示 ----

async function main() {
  const hooks = new HookSystem();

  // 注册所有 hooks
  createLoggingHooks(hooks);
  createSafetyHooks(hooks);
  const getMetrics = createMetricsHooks(hooks);

  const executor = new InstrumentedExecutor(hooks);

  console.log("=== Hook System Demo ===\n");

  // 正常操作
  console.log("1. Normal tool call:");
  const result1 = await executor.callTool(
    "read_file",
    { path: "README.md" },
    async () => "file contents here..."
  );
  console.log(`   Result: ${result1}\n`);

  // 状态变化
  console.log("2. State change:");
  await hooks.emit("on:state_change", {
    from: "EXECUTING",
    to: "VERIFYING",
    event: "STEP_COMPLETE",
  });
  console.log();

  // 危险操作（会被阻止）
  console.log("3. Dangerous tool call (should be blocked):");
  const result2 = await executor.callTool(
    "delete_file",
    { path: "/important/file.ts" },
    async () => "deleted"
  );
  console.log(`   Result: ${result2} (null = blocked)\n`);

  // 另一个正常操作
  console.log("4. Another normal tool call:");
  await executor.callTool(
    "write_file",
    { path: "output.ts", content: "..." },
    async () => "written"
  );

  // 打印指标
  console.log("\n=== Metrics ===");
  console.log(getMetrics());
}

main().catch(console.error);

/**
 * 关键观察：
 * 1. Hook 系统让你在不修改核心逻辑的情况下添加日志、安全检查、指标
 * 2. 返回 false 可以阻止操作——这是安全边界的实现方式
 * 3. 多个 hooks 可以叠加，按注册顺序执行
 * 4. 这就是 Claude Code 的 hooks 系统的简化版
 */
