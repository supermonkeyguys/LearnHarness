/**
 * M6 - 模型路由器
 *
 * 核心概念：
 * - 不同任务用不同模型：简单任务用便宜模型，复杂任务用强模型
 * - 成本 vs 质量 tradeoff
 * - 路由决策基于任务特征，不是随机的
 */

// ---- 模型定义 ----

interface Model {
  id: string;
  tier: "fast" | "balanced" | "powerful";
  costPer1kInputTokens: number;   // USD
  costPer1kOutputTokens: number;
  contextWindow: number;
  avgLatencyMs: number;
  capabilities: string[];
}

const MODELS: Record<string, Model> = {
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    tier: "fast",
    costPer1kInputTokens: 0.0008,
    costPer1kOutputTokens: 0.004,
    contextWindow: 200_000,
    avgLatencyMs: 500,
    capabilities: ["text", "code", "analysis"],
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    tier: "balanced",
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
    contextWindow: 200_000,
    avgLatencyMs: 1500,
    capabilities: ["text", "code", "analysis", "reasoning", "complex-tasks"],
  },
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    tier: "powerful",
    costPer1kInputTokens: 0.015,
    costPer1kOutputTokens: 0.075,
    contextWindow: 200_000,
    avgLatencyMs: 3000,
    capabilities: ["text", "code", "analysis", "reasoning", "complex-tasks", "architecture", "research"],
  },
};

// ---- 任务特征 ----

interface TaskFeatures {
  type: "planning" | "implementation" | "review" | "summarization" | "simple-qa";
  complexity: "low" | "medium" | "high";
  estimatedInputTokens: number;
  requiresReasoning: boolean;
  isLatencySensitive: boolean;
  budgetUsd?: number; // 可选：最大预算
}

// ---- 路由决策 ----

interface RoutingDecision {
  model: Model;
  reason: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
}

// ---- 模型路由器 ----

class ModelRouter {
  route(task: TaskFeatures): RoutingDecision {
    let selectedModel: Model;
    let reason: string;

    // 路由规则（优先级从高到低）
    if (task.budgetUsd !== undefined) {
      // 预算限制：选择在预算内最强的模型
      const estimatedOutputTokens = 500; // 默认估算
      const affordable = Object.values(MODELS)
        .filter((m) => {
          const cost = (task.estimatedInputTokens / 1000) * m.costPer1kInputTokens
            + (estimatedOutputTokens / 1000) * m.costPer1kOutputTokens;
          return cost <= task.budgetUsd!;
        })
        .sort((a, b) => b.costPer1kInputTokens - a.costPer1kInputTokens); // 最贵的（最强的）在前

      selectedModel = affordable[0] ?? MODELS["claude-haiku-4-5"];
      reason = `Budget constraint ($${task.budgetUsd.toFixed(4)}) → ${selectedModel.id}`;

    } else if (task.isLatencySensitive && task.complexity === "low") {
      // 延迟敏感 + 简单任务 → 最快模型
      selectedModel = MODELS["claude-haiku-4-5"];
      reason = "Latency-sensitive + low complexity → fast model";

    } else if (task.type === "planning" || task.requiresReasoning || task.complexity === "high") {
      // 规划/推理/复杂任务 → 最强模型
      selectedModel = MODELS["claude-opus-4-5"];
      reason = `${task.type === "planning" ? "Planning task" : task.requiresReasoning ? "Requires reasoning" : "High complexity"} → powerful model`;

    } else if (task.type === "summarization" || task.type === "simple-qa") {
      // 摘要/简单问答 → 最快模型
      selectedModel = MODELS["claude-haiku-4-5"];
      reason = `${task.type} → fast model`;

    } else {
      // 默认：平衡模型
      selectedModel = MODELS["claude-sonnet-4-5"];
      reason = "Default → balanced model";
    }

    const estimatedOutputTokens = task.complexity === "high" ? 1500 : task.complexity === "medium" ? 800 : 300;
    const estimatedCostUsd =
      (task.estimatedInputTokens / 1000) * selectedModel.costPer1kInputTokens +
      (estimatedOutputTokens / 1000) * selectedModel.costPer1kOutputTokens;

    return { model: selectedModel, reason, estimatedCostUsd, estimatedLatencyMs: selectedModel.avgLatencyMs };
  }

  // 批量路由分析：给定一个任务列表，估算总成本
  analyzeBatch(tasks: TaskFeatures[]): void {
    let totalCost = 0;
    const modelUsage: Record<string, number> = {};

    tasks.forEach((task, i) => {
      const decision = this.route(task);
      totalCost += decision.estimatedCostUsd;
      modelUsage[decision.model.id] = (modelUsage[decision.model.id] ?? 0) + 1;
      console.log(`  Task ${i + 1} (${task.type}/${task.complexity}): ${decision.model.id} — $${decision.estimatedCostUsd.toFixed(4)} — ${decision.reason}`);
    });

    console.log(`\n  Total estimated cost: $${totalCost.toFixed(4)}`);
    console.log("  Model distribution:");
    Object.entries(modelUsage).forEach(([model, count]) => {
      console.log(`    ${model}: ${count} tasks`);
    });
  }
}

// ---- 演示 ----

function main() {
  console.log("=== Model Router Demo ===\n");

  const router = new ModelRouter();

  // 演示单个路由决策
  console.log("1. Individual routing decisions:");
  const examples: Array<[string, TaskFeatures]> = [
    ["Simple summarization", { type: "summarization", complexity: "low", estimatedInputTokens: 1000, requiresReasoning: false, isLatencySensitive: false }],
    ["Architecture planning", { type: "planning", complexity: "high", estimatedInputTokens: 5000, requiresReasoning: true, isLatencySensitive: false }],
    ["Quick code completion", { type: "implementation", complexity: "low", estimatedInputTokens: 500, requiresReasoning: false, isLatencySensitive: true }],
    ["Complex refactor", { type: "implementation", complexity: "high", estimatedInputTokens: 8000, requiresReasoning: true, isLatencySensitive: false }],
    ["Budget-constrained task", { type: "implementation", complexity: "medium", estimatedInputTokens: 2000, requiresReasoning: false, isLatencySensitive: false, budgetUsd: 0.005 }],
  ];

  examples.forEach(([name, task]) => {
    const decision = router.route(task);
    console.log(`\n  "${name}":`);
    console.log(`    → ${decision.model.id} (${decision.model.tier})`);
    console.log(`    Reason: ${decision.reason}`);
    console.log(`    Est. cost: $${decision.estimatedCostUsd.toFixed(4)}, latency: ~${decision.estimatedLatencyMs}ms`);
  });

  // 批量分析
  console.log("\n\n2. Batch analysis (PRD → code pipeline):");
  const pipelineTasks: TaskFeatures[] = [
    { type: "planning", complexity: "high", estimatedInputTokens: 3000, requiresReasoning: true, isLatencySensitive: false },
    { type: "implementation", complexity: "medium", estimatedInputTokens: 2000, requiresReasoning: false, isLatencySensitive: false },
    { type: "implementation", complexity: "medium", estimatedInputTokens: 2000, requiresReasoning: false, isLatencySensitive: false },
    { type: "review", complexity: "medium", estimatedInputTokens: 4000, requiresReasoning: true, isLatencySensitive: false },
    { type: "summarization", complexity: "low", estimatedInputTokens: 1000, requiresReasoning: false, isLatencySensitive: false },
  ];
  router.analyzeBatch(pipelineTasks);

  console.log("\n--- 关键观察 ---");
  console.log("1. 规划任务用强模型：一个差的 plan 会让所有后续工作白费");
  console.log("2. 实现任务用平衡模型：质量够用，成本合理");
  console.log("3. 摘要/简单问答用快模型：这些任务不需要强推理能力");
  console.log("4. 预算限制是硬约束，在预算内选最强的");
}

main();
