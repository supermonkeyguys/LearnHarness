export {};

/**
 * M2 - Skill 按需加载系统
 *
 * 来源视角：learn-claude-code s05 (shareAI-lab)
 * 核心洞见：知识不应该全部塞进 system prompt，而应该按需注入
 *
 * 对比你已有的 02-system-prompt-template.ts（静态模板）：
 * - 静态模板：所有内容在启动时就固定在 system prompt 里
 * - Skill 系统：system prompt 只放名字列表，用到时才加载完整内容
 *
 * 为什么重要：
 *   10 个 skill × 2000 tokens = 20,000 tokens 浪费
 *   任何一次对话只会用到其中 1-2 个 skill
 *   → 把 skill 内容改为 tool_result 注入，节省 90% context
 *
 * 两层架构：
 *   Layer 1 (system prompt): skill 名字 + 一行描述  ~100 tokens/skill
 *   Layer 2 (tool_result):   完整 skill 内容        ~2000 tokens（按需）
 */

import * as fs from "fs";
import * as path from "path";

// ---- Skill 文件格式 ----
// 每个 skill 是一个目录，包含 SKILL.md
// SKILL.md 格式：
//   ---
//   name: git-workflow
//   description: Git branching and commit conventions
//   triggers: ["git", "commit", "branch", "merge"]
//   ---
//   (完整的 skill 内容)

interface SkillMeta {
  name: string;
  description: string;
  triggers: string[]; // 自动触发关键词（可选）
}

interface Skill {
  meta: SkillMeta;
  body: string;       // SKILL.md 中 frontmatter 以下的完整内容
  filePath: string;
}

// ---- Skill 加载器 ----

class SkillLoader {
  private skills = new Map<string, Skill>();

  constructor(skillsDir: string) {
    this.scan(skillsDir);
  }

  private scan(dir: string) {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, "utf-8");
      const skill = this.parse(raw, skillFile);
      if (skill) {
        this.skills.set(skill.meta.name, skill);
      }
    }

    console.log(`  [SkillLoader] Loaded ${this.skills.size} skills: ${[...this.skills.keys()].join(", ")}`);
  }

  private parse(raw: string, filePath: string): Skill | null {
    // 解析 YAML frontmatter
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    try {
      // 简单的 YAML key:value 解析（不依赖外部库）
      const meta: Partial<SkillMeta> = {};
      for (const line of match[1].split("\n")) {
        const [key, ...rest] = line.split(":");
        if (!key?.trim()) continue;
        const value = rest.join(":").trim();
        if (key.trim() === "name") meta.name = value;
        if (key.trim() === "description") meta.description = value;
        if (key.trim() === "triggers") {
          meta.triggers = value
            .replace(/[\[\]"]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }

      if (!meta.name) return null;

      return {
        meta: { name: meta.name, description: meta.description ?? "", triggers: meta.triggers ?? [] },
        body: match[2].trim(),
        filePath,
      };
    } catch {
      return null;
    }
  }

  // Layer 1: 注入 system prompt 的内容（只有名字和描述）
  getDescriptions(): string {
    if (this.skills.size === 0) return "  (no skills available)";
    return [...this.skills.values()]
      .map((s) => `  - ${s.meta.name}: ${s.meta.description}`)
      .join("\n");
  }

  // Layer 2: 按需加载完整 skill 内容（通过 tool_result 注入）
  load(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) {
      return `Error: Unknown skill '${name}'. Available: ${[...this.skills.keys()].join(", ")}`;
    }
    // 用 XML tags 包裹，让 LLM 清楚地知道这是 skill 内容
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }

  // 根据用户输入自动检测应该加载哪个 skill
  detectRelevant(userMessage: string): string[] {
    const lower = userMessage.toLowerCase();
    return [...this.skills.values()]
      .filter((s) => s.meta.triggers.some((t) => lower.includes(t)))
      .map((s) => s.meta.name);
  }

  list(): SkillMeta[] {
    return [...this.skills.values()].map((s) => s.meta);
  }
}

// ---- Mock Agent Loop（展示 skill 如何在 loop 中工作）----

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, string> };

type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: "user" | "assistant"; content: string | ContentBlock[] | ToolResultBlock[] };
type LLMResponse = { stop_reason: "end_turn" | "tool_use"; content: ContentBlock[] };

// Mock LLM：模拟按需加载 skill 的行为
class MockSkillAwareLLM {
  private callCount = 0;

  async call(_systemPrompt: string, messages: Message[]): Promise<LLMResponse> {
    this.callCount++;
    await sleep(50);

    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const content = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    // 第一次调用：检测到需要 git skill，先加载
    if (this.callCount === 1 && content.includes("git")) {
      return {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I need to follow git conventions. Let me load the git-workflow skill first." },
          { type: "tool_use", id: "t1", name: "load_skill", input: { name: "git-workflow" } },
        ],
      };
    }

    // 第二次调用：skill 已加载，给出最终答案
    if (this.callCount === 2) {
      return {
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Based on the git-workflow skill: use conventional commits format 'feat(scope): description'. Branch from main, squash before merge." },
        ],
      };
    }

    // 其他情况：直接回答（不需要 skill）
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Here's the answer without needing any skill." }],
    };
  }
}

async function runSkillDemo(loader: SkillLoader, userMessage: string): Promise<void> {
  const llm = new MockSkillAwareLLM();

  // Layer 1: system prompt 只包含 skill 名字列表
  const systemPrompt = `You are a coding assistant.
Skills available (load with load_skill tool when needed):
${loader.getDescriptions()}`;

  const messages: Message[] = [{ role: "user", content: userMessage }];

  console.log(`\nUser: ${userMessage}`);
  console.log(`System prompt size: ~${Math.ceil(systemPrompt.length / 4)} tokens`);

  // 自动检测相关 skill（可选的主动提示）
  const relevant = loader.detectRelevant(userMessage);
  if (relevant.length > 0) {
    console.log(`  [Auto-detect] Relevant skills: ${relevant.join(", ")}`);
  }

  let stepCount = 0;
  while (stepCount++ < 5) {
    const response = await llm.call(systemPrompt, messages);

    const texts = response.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    if (texts.length > 0) console.log(`  [Think] ${texts[0].text.slice(0, 80)}...`);

    if (response.stop_reason === "end_turn") {
      const answer = texts.map((b) => b.text).join("");
      console.log(`\nAnswer: ${answer}`);
      return;
    }

    // 处理 tool calls
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, string> } => b.type === "tool_use");
    const toolResults: ToolResultBlock[] = [];

    for (const block of toolUses) {
      if (block.name === "load_skill") {
        const skillName = block.input.name;
        const content = loader.load(skillName);
        const tokenCost = Math.ceil(content.length / 4);
        console.log(`  [Skill] Loaded '${skillName}' (~${tokenCost} tokens) via tool_result`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 创建演示用的 skill 文件 ----

function createDemoSkills(dir: string) {
  const skills = [
    {
      name: "git-workflow",
      description: "Git branching, commit conventions, and merge strategies",
      triggers: ["git", "commit", "branch", "merge", "pr", "pull request"],
      body: `## Git Workflow

### Commit Format
Use conventional commits: \`type(scope): description\`
Types: feat, fix, docs, refactor, test, chore

### Branch Strategy
- main: production-ready code only
- feature/xxx: new features (branch from main)
- fix/xxx: bug fixes

### Merge Rules
1. Squash commits before merging feature branches
2. Require at least 1 approval
3. CI must pass before merge`,
    },
    {
      name: "code-review",
      description: "Code review checklist and standards",
      triggers: ["review", "pr", "check", "quality"],
      body: `## Code Review Checklist

### Must Check
- [ ] No hardcoded secrets or API keys
- [ ] Error handling for all async operations
- [ ] No 'any' type in TypeScript
- [ ] Unit tests for new functions

### Should Check
- [ ] Function names are descriptive
- [ ] No duplicate code (DRY)
- [ ] Performance: no N+1 queries`,
    },
    {
      name: "testing",
      description: "Testing patterns and best practices",
      triggers: ["test", "spec", "jest", "unit test", "coverage"],
      body: `## Testing Standards

### Structure
\`\`\`
describe('ComponentName', () => {
  it('should do X when Y', () => { ... })
})
\`\`\`

### Coverage Targets
- Statements: 80%+
- Branches: 75%+
- Functions: 90%+

### Patterns
- AAA: Arrange, Act, Assert
- One assertion per test (ideally)
- Mock external dependencies`,
    },
  ];

  for (const skill of skills) {
    const skillDir = path.join(dir, skill.name);
    fs.mkdirSync(skillDir, { recursive: true });
    const content = `---
name: ${skill.name}
description: ${skill.description}
triggers: [${skill.triggers.map((t) => `"${t}"`).join(", ")}]
---

${skill.body}`;
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  }
}

// ---- 演示 ----

async function main() {
  console.log("=== Skill Loader Demo ===\n");

  const skillsDir = path.join(__dirname, "../../.tmp/skills");
  createDemoSkills(skillsDir);

  const loader = new SkillLoader(skillsDir);

  // 对比：静态 system prompt vs 动态 skill 加载
  const staticPromptTokens =
    loader.list().reduce((sum, s) => sum + 500, 0); // 假设每个 skill 500 tokens
  const dynamicBaseTokens = Math.ceil(loader.getDescriptions().length / 4);

  console.log("\n--- Token Cost Comparison ---");
  console.log(`Static (all skills in system prompt): ~${staticPromptTokens} tokens (every call)`);
  console.log(`Dynamic (skill names only):           ~${dynamicBaseTokens} tokens (base)`);
  console.log(`Dynamic (when git skill needed):      ~${dynamicBaseTokens + 500} tokens (loaded on demand)`);
  console.log(`Savings for unrelated tasks:          ~${staticPromptTokens - dynamicBaseTokens} tokens`);

  // 演示 1：需要 git skill
  console.log("\n--- Demo 1: Task that needs git skill ---");
  await runSkillDemo(loader, "How should I structure my git commits for this feature?");

  // 演示 2：不需要任何 skill
  console.log("\n--- Demo 2: Task that needs no skill ---");
  await runSkillDemo(loader, "What is 2 + 2?");

  // 演示 3：手动列出所有 skill
  console.log("\n--- Demo 3: Available skills ---");
  loader.list().forEach((s) => {
    console.log(`  ${s.name}: ${s.description}`);
    console.log(`    triggers: ${s.triggers.join(", ")}`);
  });

  // 清理
  fs.rmSync(skillsDir, { recursive: true, force: true });

  console.log("\n--- 关键观察（来自 learn-claude-code s05）---");
  console.log("1. System prompt 只放 skill 名字（Layer 1），完整内容通过 tool_result 注入（Layer 2）");
  console.log("2. 这正是 Claude Code 的 skill 系统工作原理——/skill 命令加载 SKILL.md");
  console.log("3. 与 M2/02-system-prompt-template.ts 的区别：模板是静态的，skill 是动态按需的");
  console.log("4. triggers 字段实现自动检测：用户提到 'git' 时自动提示加载 git-workflow skill");
}

main().catch(console.error);
