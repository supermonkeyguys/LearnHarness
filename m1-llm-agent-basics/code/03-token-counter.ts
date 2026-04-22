/**
 * M1 - Token 计数与成本估算
 *
 * 核心概念：
 * - Token 是 LLM 的计量单位，不等于字符或单词
 * - Context window 限制 = token 限制
 * - 成本 = input tokens × 价格 + output tokens × 价格
 *
 * 注意：精确计数需要 tiktoken 等库。
 * 这里用"每4个字符约1个token"的近似规则演示概念。
 */

// ---- Token 估算 ----

function estimateTokens(text: string): number {
  // 粗略规则：英文约 4 字符/token，中文约 1.5 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// ---- 模型价格表（USD per 1M tokens，2024年参考）----

const MODEL_PRICING: Record<string, { input: number; output: number; contextWindow: number }> = {
  "claude-opus-4-5":    { input: 15.0,  output: 75.0,  contextWindow: 200_000 },
  "claude-sonnet-4-5":  { input: 3.0,   output: 15.0,  contextWindow: 200_000 },
  "claude-haiku-4-5":   { input: 0.8,   output: 4.0,   contextWindow: 200_000 },
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCost: number; outputCost: number; total: number } {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`Unknown model: ${model}`);

  const inputCost  = (inputTokens  / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, total: inputCost + outputCost };
}

// ---- Context 使用率分析 ----

interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  usagePercent: number;
  remainingTokens: number;
  warning: string | null;
}

function analyzeContextUsage(model: string, messages: string[]): ContextUsage {
  const pricing = MODEL_PRICING[model];
  const usedTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const maxTokens = pricing.contextWindow;
  const usagePercent = (usedTokens / maxTokens) * 100;
  const remainingTokens = maxTokens - usedTokens;

  let warning: string | null = null;
  if (usagePercent > 90) warning = "CRITICAL: context almost full, must compress now";
  else if (usagePercent > 75) warning = "WARNING: context 75%+ full, consider compressing";
  else if (usagePercent > 50) warning = "INFO: context half full";

  return { usedTokens, maxTokens, usagePercent, remainingTokens, warning };
}

// ---- 演示 ----

function demo() {
  console.log("=== Token Counter Demo ===\n");

  // 1. 基本 token 估算
  const samples = [
    "Hello, world!",
    "What is the meaning of life?",
    "请帮我写一个 TypeScript 函数，实现快速排序算法。",
    "A".repeat(1000),
  ];

  console.log("1. Token estimates:");
  for (const s of samples) {
    const tokens = estimateTokens(s);
    console.log(`   "${s.slice(0, 40)}${s.length > 40 ? "..." : ""}" → ~${tokens} tokens`);
  }

  // 2. 成本估算：一个典型 agent 任务
  console.log("\n2. Cost estimate for a typical agent task:");
  const taskInputTokens  = 5_000;  // system prompt + task description + history
  const taskOutputTokens = 2_000;  // generated code + reasoning

  for (const model of Object.keys(MODEL_PRICING)) {
    const cost = estimateCost(model, taskInputTokens, taskOutputTokens);
    console.log(`   ${model}: $${cost.total.toFixed(4)} (in: $${cost.inputCost.toFixed(4)}, out: $${cost.outputCost.toFixed(4)})`);
  }

  // 3. Context 使用率分析
  console.log("\n3. Context usage analysis:");
  const conversationHistory = [
    "System: You are a helpful coding assistant...".repeat(10),   // system prompt ~500 tokens
    "User: Please implement a full REST API with authentication", // ~20 tokens
    "Assistant: Sure! Here's the implementation...".repeat(50),  // ~2500 tokens
    "User: Now add rate limiting",                               // ~10 tokens
    "Assistant: I'll add rate limiting...".repeat(30),           // ~1500 tokens
  ];

  const usage = analyzeContextUsage("claude-haiku-4-5", conversationHistory);
  console.log(`   Used: ${usage.usedTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens`);
  console.log(`   Usage: ${usage.usagePercent.toFixed(1)}%`);
  console.log(`   Remaining: ${usage.remainingTokens.toLocaleString()} tokens`);
  if (usage.warning) console.log(`   ⚠️  ${usage.warning}`);

  // 4. 为什么 context window 是核心约束
  console.log("\n4. Why context window matters for harness design:");
  console.log("   A 200k token window sounds huge, but consider:");
  const codebase = 500;    // 500 files × 200 lines × 50 chars/line ÷ 4 ≈ tokens
  const history  = 50_000; // 50 back-and-forth turns
  const output   = 10_000; // room for generated code
  console.log(`   - Loading a medium codebase: ~${codebase.toLocaleString()} tokens`);
  console.log(`   - Long conversation history: ~${history.toLocaleString()} tokens`);
  console.log(`   - Room for output: ~${output.toLocaleString()} tokens`);
  console.log(`   → Total: ${(codebase + history + output).toLocaleString()} tokens`);
  console.log("   → This is why harness needs memory management (M5)");
}

demo();
