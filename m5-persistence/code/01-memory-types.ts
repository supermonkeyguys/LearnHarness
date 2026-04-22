/**
 * M5 - 三种 Memory 类型
 *
 * Working Memory  → 当前 context（贵、快、有限）
 * Episodic Memory → 任务历史（发生了什么）
 * Semantic Memory → 知识库（学到了什么）
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// 1. Working Memory — 当前 context 窗口的抽象
// ============================================================

interface Message { role: "user" | "assistant" | "system"; content: string }

class WorkingMemory {
  private messages: Message[] = [];
  private readonly maxTokens: number;

  constructor(maxTokens = 8000) {
    this.maxTokens = maxTokens;
  }

  add(message: Message) {
    this.messages.push(message);
  }

  // 估算当前 token 使用量
  estimatedTokens(): number {
    return Math.ceil(this.messages.reduce((s, m) => s + m.content.length, 0) / 4);
  }

  usagePercent(): number {
    return (this.estimatedTokens() / this.maxTokens) * 100;
  }

  // 获取最近 N 条消息（sliding window）
  getRecent(n: number): Message[] {
    return this.messages.slice(-n);
  }

  // 获取全部（用于 LLM 调用）
  getAll(): Message[] {
    return [...this.messages];
  }

  clear() { this.messages = []; }

  stats() {
    return {
      messageCount: this.messages.length,
      estimatedTokens: this.estimatedTokens(),
      usagePercent: this.usagePercent().toFixed(1) + "%",
    };
  }
}

// ============================================================
// 2. Episodic Memory — 任务历史记录
// ============================================================

interface Episode {
  id: string;
  timestamp: string;
  type: "task_start" | "step_complete" | "error" | "task_done";
  summary: string;
  data?: Record<string, unknown>;
}

class EpisodicMemory {
  private episodes: Episode[] = [];
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.load();
  }

  record(type: Episode["type"], summary: string, data?: Record<string, unknown>) {
    const episode: Episode = {
      id: `ep_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type,
      summary,
      data,
    };
    this.episodes.push(episode);
    this.persist();
    return episode;
  }

  // 获取最近的 N 个事件
  getRecent(n: number): Episode[] {
    return this.episodes.slice(-n);
  }

  // 按类型过滤
  getByType(type: Episode["type"]): Episode[] {
    return this.episodes.filter((e) => e.type === type);
  }

  // 生成摘要（用于注入 working memory）
  summarize(maxEpisodes = 10): string {
    const recent = this.getRecent(maxEpisodes);
    return recent.map((e) => `[${e.type}] ${e.summary}`).join("\n");
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.episodes, null, 2));
  }

  private load() {
    if (fs.existsSync(this.storePath)) {
      try {
        this.episodes = JSON.parse(fs.readFileSync(this.storePath, "utf-8")) as Episode[];
      } catch { this.episodes = []; }
    }
  }

  clear() {
    this.episodes = [];
    if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
  }
}

// ============================================================
// 3. Semantic Memory — 结构化知识库
// ============================================================

interface KnowledgeEntry {
  key: string;       // 唯一标识
  category: string;  // 分类（"convention", "pattern", "error-fix"）
  content: string;   // 知识内容
  confidence: number; // 0-1，越高越可靠
  updatedAt: string;
}

class SemanticMemory {
  private entries = new Map<string, KnowledgeEntry>();
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.load();
  }

  set(key: string, category: string, content: string, confidence = 1.0) {
    this.entries.set(key, {
      key, category, content, confidence,
      updatedAt: new Date().toISOString(),
    });
    this.persist();
  }

  get(key: string): KnowledgeEntry | undefined {
    return this.entries.get(key);
  }

  // 按分类检索
  getByCategory(category: string): KnowledgeEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  // 生成注入 context 的摘要
  toContextString(category?: string): string {
    const entries = category ? this.getByCategory(category) : Array.from(this.entries.values());
    return entries
      .sort((a, b) => b.confidence - a.confidence)
      .map((e) => `[${e.category}] ${e.key}: ${e.content}`)
      .join("\n");
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(Array.from(this.entries.values()), null, 2));
  }

  private load() {
    if (fs.existsSync(this.storePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8")) as KnowledgeEntry[];
        data.forEach((e) => this.entries.set(e.key, e));
      } catch {}
    }
  }

  clear() {
    this.entries.clear();
    if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
  }
}

// ---- 演示 ----

async function main() {
  console.log("=== Memory Types Demo ===\n");
  const tmpDir = path.join(__dirname, "../../.tmp/memory-demo");

  // 1. Working Memory
  console.log("1. Working Memory (context window simulation):");
  const wm = new WorkingMemory(4000);
  wm.add({ role: "system", content: "You are a harness agent. ".repeat(20) });
  wm.add({ role: "user", content: "Implement user authentication" });
  wm.add({ role: "assistant", content: "I'll start by designing the JWT schema. ".repeat(30) });
  wm.add({ role: "user", content: "Now add refresh token support" });
  console.log("  Stats:", wm.stats());
  console.log("  Recent 2 messages:", wm.getRecent(2).map((m) => `[${m.role}] ${m.content.slice(0, 40)}...`));

  // 2. Episodic Memory
  console.log("\n2. Episodic Memory (task history):");
  const em = new EpisodicMemory(path.join(tmpDir, "episodes.json"));
  em.clear();
  em.record("task_start", "Started: implement auth system");
  em.record("step_complete", "Completed: JWT schema design", { tokens: 500 });
  em.record("error", "Failed: tsc error in middleware.ts", { error: "Type 'string' is not assignable..." });
  em.record("step_complete", "Fixed: type error resolved");
  em.record("task_done", "Completed: auth system implemented");

  console.log("  Recent 3 episodes:");
  em.getRecent(3).forEach((e) => console.log(`    [${e.type}] ${e.summary}`));
  console.log("  Summary for context injection:\n  " + em.summarize(3).replace(/\n/g, "\n  "));

  // 3. Semantic Memory
  console.log("\n3. Semantic Memory (knowledge base):");
  const sm = new SemanticMemory(path.join(tmpDir, "knowledge.json"));
  sm.clear();
  sm.set("error-pattern-1", "error-fix", "When tsc reports 'implicit any', add explicit type annotation", 0.95);
  sm.set("convention-1", "convention", "This project uses 2-space indentation and single quotes", 1.0);
  sm.set("pattern-jwt", "pattern", "JWT tokens expire in 24h, refresh tokens in 7d", 0.9);

  console.log("  All knowledge:");
  console.log("  " + sm.toContextString().replace(/\n/g, "\n  "));

  // 4. 三者协作
  console.log("\n4. How they work together:");
  console.log("  Working Memory: holds the current conversation (expensive, limited)");
  console.log("  Episodic Memory: records what happened (cheap, persistent)");
  console.log("  Semantic Memory: stores learned patterns (cheap, reusable)");
  console.log("  → When context is full: compress Working Memory using Episodic + Semantic summaries");

  // 清理
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(console.error);
