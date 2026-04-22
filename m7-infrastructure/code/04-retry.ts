/**
 * M7 - 重试与熔断器
 *
 * 核心概念：
 * - 指数退避：每次重试等待时间翻倍，避免雪崩
 * - 熔断器：连续失败后停止重试，保护下游服务
 * - 错误分类：可重试 vs 不可重试
 */

// ---- 错误分类 ----

class RetryableError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof FatalError) return false;
  if (error instanceof RetryableError) return true;
  // 网络错误、超时等通常可重试
  const msg = (error as Error).message?.toLowerCase() ?? "";
  return msg.includes("timeout") || msg.includes("rate limit") || msg.includes("503") || msg.includes("network");
}

// ---- 指数退避重试 ----

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;   // 每次等待时间乘以这个系数
  jitter: boolean;         // 加入随机抖动，防止多个客户端同时重试
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitter: true,
};

async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 不可重试的错误：立即抛出
      if (!isRetryable(error)) {
        throw error;
      }

      // 最后一次尝试失败
      if (attempt === opts.maxAttempts) break;

      // 计算等待时间（指数退避 + 抖动）
      let delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelayMs
      );

      // 如果错误指定了 retryAfter，使用那个值
      if (error instanceof RetryableError && error.retryAfterMs) {
        delay = error.retryAfterMs;
      }

      // 加入 ±25% 的随机抖动
      if (opts.jitter) {
        delay = delay * (0.75 + Math.random() * 0.5);
      }

      delay = Math.round(delay);
      onRetry?.(attempt, error, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ---- 熔断器 ----

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly failureThreshold: number = 5,    // 连续失败多少次后打开
    private readonly resetTimeoutMs: number = 60_000,  // 打开后多久尝试半开
    private readonly halfOpenSuccessThreshold = 2      // 半开状态成功多少次后关闭
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      // 检查是否应该进入 HALF_OPEN
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        console.log("  [CircuitBreaker] → HALF_OPEN (testing recovery)");
      } else {
        throw new Error(`Circuit breaker OPEN — refusing request (retry after ${Math.round((this.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s)`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
        console.log("  [CircuitBreaker] → CLOSED (recovered)");
      }
    } else {
      this.failureCount = 0; // 成功后重置失败计数
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.log(`  [CircuitBreaker] → OPEN (${this.failureCount} failures)`);
    }
  }

  getState() { return this.state; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Retry & Circuit Breaker Demo ===\n");

  // 1. 指数退避重试
  console.log("--- 1. Exponential Backoff Retry ---");
  let callCount = 0;

  try {
    await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new RetryableError(`Rate limited (attempt ${callCount})`, 100);
        }
        return "success!";
      },
      { maxAttempts: 4, initialDelayMs: 100, jitter: false },
      (attempt, error, delayMs) => {
        console.log(`  Attempt ${attempt} failed: ${(error as Error).message} — retrying in ${delayMs}ms`);
      }
    );
    console.log(`  ✅ Succeeded on attempt ${callCount}`);
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
  }

  // 2. 不可重试错误立即抛出
  console.log("\n--- 2. Fatal error (no retry) ---");
  callCount = 0;
  try {
    await withRetry(async () => {
      callCount++;
      throw new FatalError("Invalid API key — cannot retry");
    }, { maxAttempts: 3 });
  } catch (e) {
    console.log(`  ✅ Correctly stopped after ${callCount} attempt(s): ${(e as Error).message}`);
  }

  // 3. 熔断器
  console.log("\n--- 3. Circuit Breaker ---");
  const breaker = new CircuitBreaker(3, 200, 2); // 3次失败打开，200ms后半开

  // 连续失败直到熔断器打开
  for (let i = 0; i < 4; i++) {
    try {
      await breaker.execute(async () => { throw new Error(`Service failure ${i + 1}`); });
    } catch (e) {
      console.log(`  Call ${i + 1}: ${(e as Error).message.slice(0, 60)}`);
    }
  }

  console.log(`  Circuit state: ${breaker.getState()}`);

  // 等待熔断器进入 HALF_OPEN
  console.log("  Waiting for circuit to half-open...");
  await sleep(250);

  // 恢复成功
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(async () => "recovered!");
      console.log(`  Recovery call ${i + 1}: success (state: ${breaker.getState()})`);
    } catch (e) {
      console.log(`  Recovery call ${i + 1}: ${(e as Error).message.slice(0, 60)}`);
    }
  }

  console.log("\n--- 关键观察 ---");
  console.log("1. 指数退避：500ms → 1000ms → 2000ms，避免同时重试造成雪崩");
  console.log("2. Jitter：加入随机抖动，防止多个 agent 同时重试打爆下游");
  console.log("3. 熔断器：连续失败后快速失败，不再等待超时，保护系统");
  console.log("4. FatalError 不重试：API key 错误重试再多次也没用");
}

main().catch(console.error);
