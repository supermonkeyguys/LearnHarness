export {};

/**
 * M5 - Context 压缩器
 *
 * 核心概念：
 * - Context 满了不能无限扩展，必须压缩
 * - 压缩策略：摘要 / 滑动窗口 / 选择性保留
 * - 压缩有信息损失，需要权衡
 */

// ---- 消息类型 ----

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  important?: boolean; // 标记为重要，压缩时保留
}

// ---- Mock LLM 摘要器 ----

class MockSummarizer {
  async summarize(messages: Message[]): Promise<string> {
    await sleep(50);
    const topics = messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content.slice(0, 30))
      .join("; ");
    return `[Summary of ${messages.length} messages covering: ${topics}]`;
  }
}

// ---- 压缩策略 ----

// 策略 1: 滑动窗口 — 只保留最近 N 条
function slidingWindow(messages: Message[], keepLast: number): Message[] {
  const system = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  return [...system, ...nonSystem.slice(-keepLast)];
}

// 策略 2: 选择性保留 — 保留 important 标记的消息
function selectiveRetention(messages: Message[]): Message[] {
  const system = messages.filter((m) => m.role === "system");
  const important = messages.filter((m) => m.role !== "system" && m.important);
  const recent = messages.filter((m) => m.role !== "system").slice(-3);

  // 去重（recent 中可能已包含 important 的消息）
  const seen = new Set<string>();
  const combined = [...system, ...important, ...recent].filter((m) => {
    if (seen.has(m.content)) return false;
    seen.add(m.content);
    return true;
  });
  return combined;
}

// 策略 3: LLM 摘要 — 把旧消息压缩成一条摘要
async function llmSummarize(
  messages: Message[],
  summarizer: MockSummarizer,
  keepRecentN = 4
): Promise<Message[]> {
  const system = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  if (nonSystem.length <= keepRecentN) return messages; // 不需要压缩

  const toSummarize = nonSystem.slice(0, -keepRecentN);
  const toKeep = nonSystem.slice(-keepRecentN);

  const summary = await summarizer.summarize(toSummarize);
  const summaryMessage: Message = {
    role: "user",
    content: summary,
    important: true,
  };

  return [...system, summaryMessage, ...toKeep];
}

// ---- 压缩触发器 ----

function estimateTokens(messages: Message[]): number {
  return Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
}

class ContextCompressor {
  constructor(
    private maxTokens: number,
    private triggerAt: number, // 达到 maxTokens 的多少比例时触发压缩
    private summarizer: MockSummarizer
  ) {}

  shouldCompress(messages: Message[]): boolean {
    return estimateTokens(messages) / this.maxTokens > this.triggerAt;
  }

  async compress(messages: Message[]): Promise<{ compressed: Message[]; savedTokens: number }> {
    const before = estimateTokens(messages);

    // 优先用 LLM 摘要（质量最好），降级到滑动窗口（最快）
    let compressed: Message[];
    try {
      compressed = await llmSummarize(messages, this.summarizer);
    } catch {
      console.log("  [Compressor] LLM summarize failed, falling back to sliding window");
      compressed = slidingWindow(messages, 6);
    }

    const after = estimateTokens(compressed);
    return { compressed, savedTokens: before - after };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Context Compressor Demo ===\n");

  // 模拟一个越来越长的对话
  const messages: Message[] = [
    { role: "system", content: "You are a coding assistant. Always output TypeScript." },
    { role: "user",   content: "Implement a user registration endpoint" },
    { role: "assistant", content: "Here's the registration handler: " + "code ".repeat(100) },
    { role: "user",   content: "Add email validation", important: true },
    { role: "assistant", content: "Added email validation using regex: " + "code ".repeat(80) },
    { role: "user",   content: "Now add password hashing" },
    { role: "assistant", content: "Added bcrypt password hashing: " + "code ".repeat(120) },
    { role: "user",   content: "Add JWT token generation", important: true },
    { role: "assistant", content: "Added JWT generation: " + "code ".repeat(90) },
    { role: "user",   content: "Write tests for all of this" },
  ];

  const totalTokens = estimateTokens(messages);
  console.log(`Original: ${messages.length} messages, ~${totalTokens} tokens\n`);

  // 演示三种策略
  const summarizer = new MockSummarizer();

  console.log("--- Strategy 1: Sliding Window (keep last 4) ---");
  const sw = slidingWindow(messages, 4);
  console.log(`  Result: ${sw.length} messages, ~${estimateTokens(sw)} tokens`);
  console.log(`  Kept: ${sw.map((m) => m.content.slice(0, 30)).join(" | ")}`);

  console.log("\n--- Strategy 2: Selective Retention ---");
  const sr = selectiveRetention(messages);
  console.log(`  Result: ${sr.length} messages, ~${estimateTokens(sr)} tokens`);
  console.log(`  Kept: ${sr.map((m) => `[${m.important ? "★" : " "}] ${m.content.slice(0, 25)}`).join(" | ")}`);

  console.log("\n--- Strategy 3: LLM Summarize ---");
  const summarized = await llmSummarize(messages, summarizer, 3);
  console.log(`  Result: ${summarized.length} messages, ~${estimateTokens(summarized)} tokens`);
  summarized.forEach((m) => console.log(`  [${m.role}] ${m.content.slice(0, 60)}...`));

  // 演示自动触发
  console.log("\n--- Auto-trigger Demo ---");
  const compressor = new ContextCompressor(500, 0.7, summarizer);
  console.log(`  Should compress? ${compressor.shouldCompress(messages)} (usage: ${(totalTokens / 500 * 100).toFixed(0)}%)`);

  if (compressor.shouldCompress(messages)) {
    const { compressed, savedTokens } = await compressor.compress(messages);
    console.log(`  Compressed: ${messages.length} → ${compressed.length} messages, saved ~${savedTokens} tokens`);
  }

  console.log("\n--- 关键观察 ---");
  console.log("1. 滑动窗口最简单但会丢失早期重要决策");
  console.log("2. 选择性保留需要调用方主动标记 important:true");
  console.log("3. LLM 摘要质量最好但本身消耗 token，且有压缩损失");
  console.log("4. 实际 harness 通常组合使用：LLM 摘要 + 保留 important 消息");
}

main().catch(console.error);
