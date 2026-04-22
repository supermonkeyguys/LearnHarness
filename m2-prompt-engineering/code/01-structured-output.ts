/**
 * M2 - 结构化输出
 *
 * 核心概念：
 * - 强制 LLM 输出可被程序解析的格式（JSON）
 * - 解析失败时的重试策略
 * - 结构化输出是 harness 解析 LLM 决策的基础
 *
 * 不需要 API Key：MockLLM 模拟各种输出场景
 */

// ---- 目标输出结构 ----

interface TaskPlan {
  title: string;
  steps: Array<{
    id: number;
    description: string;
    estimatedTokens: number;
    canParallelize: boolean;
  }>;
  totalSteps: number;
  riskLevel: "low" | "medium" | "high";
}

// ---- Mock LLM：模拟三种常见输出场景 ----

type MockScenario = "perfect" | "wrapped_in_markdown" | "malformed";

export class MockLLM {
  constructor(private scenario: MockScenario) {}

  async generate(_prompt: string): Promise<string> {
    await sleep(50);

    switch (this.scenario) {
      // 场景1：完美的 JSON（理想情况）
      case "perfect":
        return JSON.stringify({
          title: "Implement user authentication",
          steps: [
            { id: 1, description: "Design JWT schema", estimatedTokens: 500, canParallelize: false },
            { id: 2, description: "Implement login endpoint", estimatedTokens: 800, canParallelize: true },
            { id: 3, description: "Implement token refresh", estimatedTokens: 600, canParallelize: true },
            { id: 4, description: "Write tests", estimatedTokens: 700, canParallelize: false },
          ],
          totalSteps: 4,
          riskLevel: "medium",
        } satisfies TaskPlan);

      // 场景2：JSON 被包在 markdown 代码块里（最常见问题）
      case "wrapped_in_markdown":
        return `Here's the plan:

\`\`\`json
{
  "title": "Implement user authentication",
  "steps": [
    { "id": 1, "description": "Design JWT schema", "estimatedTokens": 500, "canParallelize": false }
  ],
  "totalSteps": 1,
  "riskLevel": "low"
}
\`\`\`

Let me know if you need changes.`;

      // 场景3：格式错误的 JSON（LLM 偶尔犯的错）
      case "malformed":
        return `{
  "title": "Implement user authentication",
  "steps": [
    { "id": 1, "description": "Design JWT schema", "estimatedTokens": 500, "canParallelize": false },
  ],  // trailing comma — invalid JSON
  "totalSteps": 1,
  "riskLevel": "low"
}`;
    }
  }
}

// ---- 结构化输出解析器 ----

class StructuredOutputParser<T> {
  constructor(private validator: (data: unknown) => data is T) {}

  parse(raw: string): T | null {
    // 策略1：直接解析
    try {
      const data = JSON.parse(raw);
      if (this.validator(data)) return data;
    } catch {}

    // 策略2：提取 markdown 代码块中的 JSON
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1].trim());
        if (this.validator(data)) return data;
      } catch {}
    }

    // 策略3：提取第一个 { } 块（宽松匹配）
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        // 移除行内注释（// ...）后再解析
        const cleaned = jsonMatch[0].replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1");
        const data = JSON.parse(cleaned);
        if (this.validator(data)) return data;
      } catch {}
    }

    return null; // 所有策略都失败
  }
}

// ---- 类型守卫 ----

function isTaskPlan(data: unknown): data is TaskPlan {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.title === "string" &&
    Array.isArray(d.steps) &&
    typeof d.totalSteps === "number" &&
    ["low", "medium", "high"].includes(d.riskLevel as string)
  );
}

// ---- 带重试的结构化输出获取 ----

async function getStructuredOutput(
  llm: MockLLM,
  prompt: string,
  maxRetries = 3
): Promise<TaskPlan> {
  const parser = new StructuredOutputParser(isTaskPlan);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`  Attempt ${attempt}/${maxRetries}...`);
    const raw = await llm.generate(prompt);
    console.log(`  Raw output (${raw.length} chars): ${raw.slice(0, 80).replace(/\n/g, "↵")}...`);

    const result = parser.parse(raw);
    if (result) {
      console.log(`  ✅ Parsed successfully`);
      return result;
    }

    console.log(`  ❌ Parse failed, retrying with stricter prompt...`);
    // 实际场景中这里会修改 prompt，要求更严格的 JSON 格式
  }

  throw new Error(`Failed to get valid structured output after ${maxRetries} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Structured Output Demo ===\n");

  const scenarios: MockScenario[] = ["perfect", "wrapped_in_markdown", "malformed"];

  for (const scenario of scenarios) {
    console.log(`\n--- Scenario: ${scenario} ---`);
    const llm = new MockLLM(scenario);
    try {
      const plan = await getStructuredOutput(llm, "Create a plan for user authentication");
      console.log(`  Result: "${plan.title}" — ${plan.totalSteps} steps, risk: ${plan.riskLevel}`);
    } catch (e) {
      console.log(`  Final error: ${(e as Error).message}`);
    }
  }

  console.log("\n--- 关键观察 ---");
  console.log("1. LLM 经常把 JSON 包在 markdown 代码块里——解析器必须处理这种情况");
  console.log("2. 三层降级策略：直接解析 → 提取代码块 → 宽松匹配");
  console.log("3. 结构化输出让 harness 能可靠地读取 LLM 的决策");
}

main().catch(console.error);
