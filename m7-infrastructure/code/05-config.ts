/**
 * M7 - 配置管理
 *
 * 核心概念：
 * - 所有可调参数集中在一处，不散落在代码里
 * - 类型安全：配置错误在启动时就能发现
 * - 敏感配置（API keys）来自环境变量，不进配置文件
 */

// ---- 配置结构 ----

interface ModelConfig {
  default: string;
  planning: string;
  implementation: string;
  review: string;
  maxTokensPerCall: number;
}

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

interface SafetyConfig {
  requireApprovalFor: string[];   // 需要人工确认的工具
  forbiddenTools: string[];       // 完全禁止的工具
  maxCostPerTaskUsd: number;      // 单任务最大成本
  maxRetries: number;
}

interface HarnessConfig {
  version: string;
  models: ModelConfig;
  retry: RetryConfig;
  safety: SafetyConfig;
  checkpointTtlMs: number;
  maxConcurrentSubagents: number;
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  logToFile: boolean;
}

// ---- 默认配置 ----

const DEFAULT_CONFIG: HarnessConfig = {
  version: "1.0.0",

  models: {
    default:        "claude-sonnet-4-5",
    planning:       "claude-opus-4-5",
    implementation: "claude-sonnet-4-5",
    review:         "claude-opus-4-5",
    maxTokensPerCall: 8192,
  },

  retry: {
    maxAttempts:    3,
    initialDelayMs: 500,
    maxDelayMs:     30_000,
    backoffFactor:  2,
  },

  safety: {
    requireApprovalFor: ["delete_file", "exec_command", "push_to_remote", "send_email"],
    forbiddenTools:     ["drop_database", "format_disk"],
    maxCostPerTaskUsd:  1.0,
    maxRetries:         3,
  },

  checkpointTtlMs:         24 * 60 * 60 * 1000, // 24h
  maxConcurrentSubagents:  4,
  logLevel:                "INFO",
  logToFile:               false,
};

// ---- 配置验证 ----

interface ValidationError { field: string; message: string }

function validateConfig(config: HarnessConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config.version) errors.push({ field: "version", message: "Required" });

  const validModels = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"];
  for (const [key, model] of Object.entries(config.models)) {
    if (key !== "maxTokensPerCall" && !validModels.includes(model as string)) {
      errors.push({ field: `models.${key}`, message: `Unknown model: ${model}` });
    }
  }

  if (config.models.maxTokensPerCall < 100 || config.models.maxTokensPerCall > 200_000) {
    errors.push({ field: "models.maxTokensPerCall", message: "Must be between 100 and 200000" });
  }

  if (config.retry.maxAttempts < 1 || config.retry.maxAttempts > 10) {
    errors.push({ field: "retry.maxAttempts", message: "Must be between 1 and 10" });
  }

  if (config.safety.maxCostPerTaskUsd <= 0) {
    errors.push({ field: "safety.maxCostPerTaskUsd", message: "Must be positive" });
  }

  if (config.maxConcurrentSubagents < 1 || config.maxConcurrentSubagents > 20) {
    errors.push({ field: "maxConcurrentSubagents", message: "Must be between 1 and 20" });
  }

  return errors;
}

// ---- 配置加载器 ----

class ConfigLoader {
  load(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
    // 深度合并默认配置和覆盖值
    const config = this.deepMerge(DEFAULT_CONFIG, overrides) as HarnessConfig;

    // 验证
    const errors = validateConfig(config);
    if (errors.length > 0) {
      const msgs = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
      throw new Error(`Invalid harness configuration:\n${msgs}`);
    }

    return config;
  }

  // 从环境变量读取敏感配置（不进配置文件）
  getSecrets(): { anthropicApiKey: string | undefined } {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  private deepMerge(base: unknown, override: unknown): unknown {
    if (typeof base !== "object" || base === null) return override ?? base;
    if (typeof override !== "object" || override === null) return base;
    const result = { ...(base as object) };
    for (const [key, value] of Object.entries(override as object)) {
      (result as Record<string, unknown>)[key] = this.deepMerge(
        (base as Record<string, unknown>)[key],
        value
      );
    }
    return result;
  }
}

// ---- 演示 ----

function main() {
  console.log("=== Config Manager Demo ===\n");

  const loader = new ConfigLoader();

  // 1. 加载默认配置
  console.log("1. Default config:");
  const config = loader.load();
  console.log(`   Version: ${config.version}`);
  console.log(`   Default model: ${config.models.default}`);
  console.log(`   Max concurrent subagents: ${config.maxConcurrentSubagents}`);
  console.log(`   Max cost per task: $${config.safety.maxCostPerTaskUsd}`);
  console.log(`   Requires approval for: ${config.safety.requireApprovalFor.join(", ")}`);

  // 2. 带覆盖的配置（例如测试环境）
  console.log("\n2. Test environment overrides:");
  const testConfig = loader.load({
    models: { default: "claude-haiku-4-5" } as Partial<ModelConfig>,
    safety: { maxCostPerTaskUsd: 0.1 } as Partial<SafetyConfig>,
    maxConcurrentSubagents: 1,
    logLevel: "DEBUG",
  });
  console.log(`   Model: ${testConfig.models.default} (cheaper for tests)`);
  console.log(`   Max cost: $${testConfig.safety.maxCostPerTaskUsd} (tighter budget)`);
  console.log(`   Concurrency: ${testConfig.maxConcurrentSubagents} (serial for debugging)`);

  // 3. 配置验证错误
  console.log("\n3. Invalid config (should throw):");
  try {
    loader.load({ retry: { maxAttempts: 100 } as RetryConfig });
  } catch (e) {
    console.log(`   ✅ Caught: ${(e as Error).message.split("\n")[0]}`);
  }

  // 4. 环境变量（敏感配置）
  console.log("\n4. Secrets from environment:");
  const secrets = loader.getSecrets();
  console.log(`   ANTHROPIC_API_KEY: ${secrets.anthropicApiKey ? "✅ set" : "❌ not set"}`);

  console.log("\n--- 关键观察 ---");
  console.log("1. 所有参数有默认值，覆盖只需写要改的部分");
  console.log("2. 验证在加载时运行——配置错误在启动时就发现，不会运行到一半才报错");
  console.log("3. API keys 来自环境变量，不进代码也不进配置文件（防止泄漏）");
  console.log("4. 测试环境用更便宜的模型和更低的成本限制，避免意外消费");
}

main();
