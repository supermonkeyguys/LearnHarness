/**
 * M2 - System Prompt 模板系统
 *
 * 核心概念：
 * - Prompt 是配置文件，不是聊天消息
 * - 四部分结构：Role / Constraints / Output Format / Context
 * - 模板系统让 prompt 可复用、可版本控制、可测试
 */

// ---- Prompt 模板的四部分结构 ----

interface PromptTemplate {
  version: string;
  role: string;           // 给 LLM 一个清晰的身份
  constraints: string[];  // 明确的限制条件
  outputFormat: string;   // 期望的输出格式
  contextSlots: string[]; // 需要动态填充的占位符
}

// ---- 模板库 ----

const TEMPLATES: Record<string, PromptTemplate> = {
  // Orchestrator：负责任务分解
  orchestrator: {
    version: "1.0.0",
    role: `You are a task orchestrator for a software development harness.
Your job is to decompose a PRD into concrete, independently executable tasks.
You do NOT write code yourself — you only plan and delegate.`,

    constraints: [
      "Each task must be completable by a single agent without external dependencies",
      "Tasks must have explicit input/output contracts",
      "Maximum 8 tasks per decomposition — if more needed, create subtask groups",
      "Never include tasks that require human judgment or approval",
      "Do not reference implementation details — describe WHAT, not HOW",
    ],

    outputFormat: `Respond with valid JSON only. No markdown, no explanation outside JSON.
Schema:
{
  "tasks": [
    {
      "id": "string (snake_case)",
      "description": "string (one sentence, imperative)",
      "inputs": ["list of required inputs"],
      "outputs": ["list of produced outputs"],
      "dependencies": ["task ids that must complete first"],
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "rationale": "string (why this decomposition)"
}`,

    contextSlots: ["{{PRD_CONTENT}}", "{{PROJECT_CONTEXT}}"],
  },

  // Subagent：负责执行单个任务
  subagent: {
    version: "1.0.0",
    role: `You are a focused implementation agent.
You execute ONE specific task with precision.
You have access to file system tools. Use them methodically.`,

    constraints: [
      "Only modify files explicitly listed in your task's scope",
      "Write TypeScript with strict types — no 'any'",
      "Every function must have a JSDoc comment",
      "Run verification after each file write",
      "If blocked, output a structured error — do not guess",
    ],

    outputFormat: `After completing the task, output:
{
  "status": "complete|blocked|failed",
  "filesModified": ["list of modified file paths"],
  "summary": "one-sentence description of what was done",
  "blockedReason": "if status=blocked, explain why"
}`,

    contextSlots: ["{{TASK_DESCRIPTION}}", "{{TASK_INPUTS}}", "{{CODEBASE_CONTEXT}}"],
  },

  // Verifier：负责代码审查
  verifier: {
    version: "1.0.0",
    role: `You are a strict code reviewer for a harness system.
You evaluate code quality, correctness, and safety.
You are adversarial — your job is to find problems.`,

    constraints: [
      "Score only what is present — do not reward intent",
      "Security issues always score 1 regardless of other quality",
      "Be specific: cite line numbers and exact problems",
      "Do not suggest style changes unless they affect correctness",
    ],

    outputFormat: `{
  "score": 1-5,
  "passed": boolean,
  "issues": [
    { "severity": "critical|major|minor", "description": "string", "line": number|null }
  ],
  "summary": "string"
}`,

    contextSlots: ["{{CODE_TO_REVIEW}}", "{{TASK_REQUIREMENTS}}"],
  },
};

// ---- 模板渲染器 ----

class PromptRenderer {
  render(templateName: string, context: Record<string, string>): string {
    const template = TEMPLATES[templateName];
    if (!template) throw new Error(`Unknown template: ${templateName}`);

    // 验证所有必需的 context slots 都已提供
    const missing = template.contextSlots.filter(
      (slot) => !(slot.replace(/[{}]/g, "") in context)
    );
    if (missing.length > 0) {
      throw new Error(`Missing context slots: ${missing.join(", ")}`);
    }

    // 组装 prompt
    let prompt = [
      `## Role\n${template.role}`,
      `## Constraints\n${template.constraints.map((c) => `- ${c}`).join("\n")}`,
      `## Output Format\n${template.outputFormat}`,
    ].join("\n\n");

    // 填充 context slots
    for (const [key, value] of Object.entries(context)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    return prompt;
  }

  // 列出所有可用模板
  listTemplates(): Array<{ name: string; version: string; slots: string[] }> {
    return Object.entries(TEMPLATES).map(([name, t]) => ({
      name,
      version: t.version,
      slots: t.contextSlots,
    }));
  }
}

// ---- 演示 ----

function main() {
  const renderer = new PromptRenderer();

  console.log("=== System Prompt Template Demo ===\n");

  // 1. 列出可用模板
  console.log("Available templates:");
  renderer.listTemplates().forEach((t) => {
    console.log(`  - ${t.name} (v${t.version}): slots = [${t.slots.join(", ")}]`);
  });

  // 2. 渲染 orchestrator prompt
  console.log("\n--- Rendered orchestrator prompt (preview) ---");
  const orchestratorPrompt = renderer.render("orchestrator", {
    PRD_CONTENT: "Build a user authentication system with JWT tokens and refresh logic.",
    PROJECT_CONTEXT: "TypeScript + Express.js project, PostgreSQL database",
  });
  console.log(orchestratorPrompt.slice(0, 600) + "\n...(truncated)");

  // 3. 演示缺少 context slot 时的错误
  console.log("\n--- Missing slot error ---");
  try {
    renderer.render("subagent", { TASK_DESCRIPTION: "Implement login endpoint" });
    // TASK_INPUTS 和 CODEBASE_CONTEXT 缺失
  } catch (e) {
    console.log(`✅ Correctly caught: ${(e as Error).message}`);
  }

  // 4. 为什么模板化很重要
  console.log("\n--- 关键观察 ---");
  console.log("1. Role / Constraints / OutputFormat / Context 四部分让 prompt 结构清晰");
  console.log("2. contextSlots 强制调用方提供所有必要信息，避免遗漏");
  console.log("3. version 字段让 prompt 可以像代码一样版本控制和回滚");
  console.log("4. 模板与渲染分离：改 prompt 不需要改业务代码");
}

main();
