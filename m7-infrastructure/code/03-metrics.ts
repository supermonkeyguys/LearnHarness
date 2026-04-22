/**
 * M7 - 指标收集
 *
 * 核心概念：
 * - 指标量化系统状态：token 消耗、延迟、成功率
 * - Counter（只增）/ Gauge（可增减）/ Histogram（分布）
 * - 任务结束后打印报告
 */

// ---- 指标类型 ----

class Counter {
  private value = 0;
  increment(by = 1) { this.value += by; }
  get() { return this.value; }
}

class Gauge {
  private value = 0;
  set(v: number) { this.value = v; }
  increment(by = 1) { this.value += by; }
  decrement(by = 1) { this.value -= by; }
  get() { return this.value; }
}

class Histogram {
  private values: number[] = [];

  record(v: number) { this.values.push(v); }

  stats() {
    if (this.values.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...this.values].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
    };
  }
}

// ---- Harness 指标注册表 ----

class HarnessMetrics {
  // Token 相关
  readonly totalInputTokens  = new Counter();
  readonly totalOutputTokens = new Counter();
  readonly tokensByModel     = new Map<string, Counter>();

  // 调用相关
  readonly llmCallCount      = new Counter();
  readonly toolCallCount     = new Counter();
  readonly llmCallDuration   = new Histogram();
  readonly toolCallDuration  = new Histogram();

  // 成功/失败
  readonly taskSuccessCount  = new Counter();
  readonly taskFailureCount  = new Counter();
  readonly retryCount        = new Counter();
  readonly qualityGatePass   = new Counter();
  readonly qualityGateFail   = new Counter();

  // 并发
  readonly activeSubagents   = new Gauge();

  recordLLMCall(model: string, inputTokens: number, outputTokens: number, durationMs: number) {
    this.llmCallCount.increment();
    this.totalInputTokens.increment(inputTokens);
    this.totalOutputTokens.increment(outputTokens);
    this.llmCallDuration.record(durationMs);

    if (!this.tokensByModel.has(model)) this.tokensByModel.set(model, new Counter());
    this.tokensByModel.get(model)!.increment(inputTokens + outputTokens);
  }

  recordToolCall(durationMs: number) {
    this.toolCallCount.increment();
    this.toolCallDuration.record(durationMs);
  }

  estimateCostUsd(): number {
    // 简化：用平均价格估算
    const inputCost  = (this.totalInputTokens.get()  / 1_000_000) * 3.0;  // $3/M input
    const outputCost = (this.totalOutputTokens.get() / 1_000_000) * 15.0; // $15/M output
    return inputCost + outputCost;
  }

  report(): void {
    const totalTasks = this.taskSuccessCount.get() + this.taskFailureCount.get();
    const successRate = totalTasks > 0 ? (this.taskSuccessCount.get() / totalTasks * 100).toFixed(1) : "N/A";
    const gateTotal = this.qualityGatePass.get() + this.qualityGateFail.get();
    const gatePassRate = gateTotal > 0 ? (this.qualityGatePass.get() / gateTotal * 100).toFixed(1) : "N/A";

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║         HARNESS METRICS REPORT       ║");
    console.log("╠══════════════════════════════════════╣");

    console.log("║ Tasks                                ║");
    console.log(`║   Success: ${String(this.taskSuccessCount.get()).padEnd(6)} Fail: ${String(this.taskFailureCount.get()).padEnd(6)} Rate: ${successRate}%`.padEnd(39) + "║");
    console.log(`║   Retries: ${String(this.retryCount.get()).padEnd(27)}║`);

    console.log("╠══════════════════════════════════════╣");
    console.log("║ LLM Calls                            ║");
    const llmStats = this.llmCallDuration.stats();
    console.log(`║   Count: ${String(this.llmCallCount.get()).padEnd(29)}║`);
    console.log(`║   Latency p50/p95: ${String(llmStats.p50).padEnd(6)}/${String(llmStats.p95).padEnd(11)}ms║`);

    console.log("╠══════════════════════════════════════╣");
    console.log("║ Tokens                               ║");
    console.log(`║   Input:  ${String(this.totalInputTokens.get().toLocaleString()).padEnd(28)}║`);
    console.log(`║   Output: ${String(this.totalOutputTokens.get().toLocaleString()).padEnd(28)}║`);
    console.log(`║   Est. cost: $${this.estimateCostUsd().toFixed(4).padEnd(24)}║`);

    console.log("╠══════════════════════════════════════╣");
    console.log("║ Quality Gates                        ║");
    console.log(`║   Pass: ${String(this.qualityGatePass.get()).padEnd(5)} Fail: ${String(this.qualityGateFail.get()).padEnd(5)} Rate: ${gatePassRate}%`.padEnd(39) + "║");

    if (this.tokensByModel.size > 0) {
      console.log("╠══════════════════════════════════════╣");
      console.log("║ Tokens by Model                      ║");
      this.tokensByModel.forEach((counter, model) => {
        const line = `║   ${model.slice(0, 20).padEnd(20)}: ${String(counter.get().toLocaleString()).padEnd(8)}`;
        console.log(line.padEnd(39) + "║");
      });
    }

    console.log("╚══════════════════════════════════════╝");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Metrics Demo ===\n");

  const metrics = new HarnessMetrics();

  // 模拟一个完整的 harness 运行
  console.log("Simulating harness run...");

  // 3 个 subagent 并行运行
  metrics.activeSubagents.set(3);

  // 模拟 LLM 调用
  const llmCalls = [
    { model: "claude-opus-4-5",   inputTokens: 3000, outputTokens: 1500, latency: 2800 },
    { model: "claude-sonnet-4-5", inputTokens: 2000, outputTokens: 800,  latency: 1200 },
    { model: "claude-sonnet-4-5", inputTokens: 2500, outputTokens: 1000, latency: 1400 },
    { model: "claude-haiku-4-5",  inputTokens: 500,  outputTokens: 200,  latency: 400  },
    { model: "claude-haiku-4-5",  inputTokens: 300,  outputTokens: 150,  latency: 350  },
  ];

  for (const call of llmCalls) {
    await sleep(10);
    metrics.recordLLMCall(call.model, call.inputTokens, call.outputTokens, call.latency);
  }

  // 模拟工具调用
  [50, 120, 30, 80, 45, 200].forEach((d) => metrics.recordToolCall(d));

  // 模拟质量门控
  metrics.qualityGatePass.increment(4);
  metrics.qualityGateFail.increment(2);
  metrics.retryCount.increment(2);

  // 模拟任务结果
  metrics.taskSuccessCount.increment(2);
  metrics.taskFailureCount.increment(1);

  metrics.activeSubagents.set(0);

  // 打印报告
  metrics.report();
}

main().catch(console.error);
