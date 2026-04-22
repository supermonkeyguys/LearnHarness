/**
 * M1 - 手动实现 ReAct Loop（无需 API Key）
 *
 * ReAct = Reasoning + Acting
 * 模式：Thought → Action → Observation → Thought → ...
 *
 * MockLLM 模拟一个"分析目录结构"的 agent：
 *   Step 1: 列出根目录
 *   Step 2: 读取 README.md
 *   Step 3: 给出最终总结
 */

import * as fs from "fs";
import * as path from "path";

// ---- 类型定义 ----

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, string> };

type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };

type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
};

type LLMResponse = {
  stop_reason: "end_turn" | "tool_use";
  content: ContentBlock[];
};

// ---- Mock LLM ----

class MockReActLLM {
  private callCount = 0;
  private observations: string[] = [];

  async createMessage(messages: Message[]): Promise<LLMResponse> {
    this.callCount++;

    // 收集最近的 observation（tool result）
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
      const results = (lastMsg.content as ToolResultBlock[])
        .filter((b) => b.type === "tool_result")
        .map((b) => b.content);
      this.observations.push(...results);
    }

    console.log(`\n  [MockLLM] Thinking... (step ${this.callCount})`);
    await sleep(50); // 模拟思考延迟

    switch (this.callCount) {
      // Step 1: 列出目录，了解项目结构
      case 1:
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "text",
              text: "I need to understand the project structure. Let me list the root directory first.",
            },
            {
              type: "tool_use",
              id: "t1",
              name: "list_directory",
              input: { path: path.join(__dirname, "../..") },
            },
          ],
        };

      // Step 2: 看到目录列表后，读 README
      case 2:
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "text",
              text: `I can see the directory structure. Now let me read the README to understand the project.`,
            },
            {
              type: "tool_use",
              id: "t2",
              name: "read_file",
              input: { path: path.join(__dirname, "../../README.md") },
            },
          ],
        };

      // Step 3: 有足够信息了，给出最终答案
      default: {
        const dirListing = this.observations[0] ?? "(no data)";
        const modules = dirListing
          .split("\n")
          .filter((line) => line.startsWith("m"))
          .join(", ");

        return {
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: `Based on my analysis:\n\nThis is a Harness learning project with ${modules.split(",").length} modules: ${modules}.\n\nEach module covers a key aspect of building AI agent harnesses, from LLM basics to infrastructure.`,
            },
          ],
        };
      }
    }
  }
}

// ---- 工具执行（真实的文件系统操作）----

function executeTool(name: string, input: Record<string, string>): string {
  try {
    switch (name) {
      case "read_file": {
        const content = fs.readFileSync(input.path, "utf-8");
        return content.slice(0, 1500);
      }
      case "list_directory": {
        const files = fs.readdirSync(input.path);
        return files.join("\n");
      }
      case "search_in_file": {
        const content = fs.readFileSync(input.path, "utf-8");
        const lines = content.split("\n").filter((l) => l.includes(input.pattern));
        return lines.length > 0 ? lines.slice(0, 10).join("\n") : "No matches found";
      }
      default:
        return `Error: Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// ---- ReAct Loop ----

interface Step {
  type: "thought" | "action" | "observation";
  content: string;
}

async function reactLoop(task: string): Promise<void> {
  const llm = new MockReActLLM();
  const steps: Step[] = [];
  const messages: Message[] = [{ role: "user", content: `Task: ${task}` }];
  const MAX_STEPS = 10;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Task: ${task}`);
  console.log(`${"=".repeat(50)}`);

  for (let stepCount = 1; stepCount <= MAX_STEPS; stepCount++) {
    console.log(`\n--- Step ${stepCount} ---`);

    const response = await llm.createMessage(messages);

    // 提取 thought
    const textBlocks = response.content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text"
    );
    if (textBlocks.length > 0) {
      const thought = textBlocks.map((b) => b.text).join("");
      console.log(`[Thought] ${thought}`);
      steps.push({ type: "thought", content: thought });
    }

    // 任务完成
    if (response.stop_reason === "end_turn") {
      console.log(`\n✅ Task complete after ${stepCount} steps`);
      console.log("\n--- Execution trace ---");
      steps.forEach((s, i) => {
        const preview = s.content.slice(0, 80).replace(/\n/g, " ");
        console.log(`  ${i + 1}. [${s.type.toUpperCase()}] ${preview}...`);
      });
      return;
    }

    // 执行工具
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, string> } =>
        b.type === "tool_use"
    );

    const toolResults: ToolResultBlock[] = [];

    for (const block of toolUseBlocks) {
      console.log(`[Action] ${block.name}(${JSON.stringify(block.input)})`);
      steps.push({ type: "action", content: `${block.name}(${JSON.stringify(block.input)})` });

      const result = executeTool(block.name, block.input);
      const preview = result.slice(0, 150).replace(/\n/g, ", ");
      console.log(`[Observation] ${preview}${result.length > 150 ? "..." : ""}`);
      steps.push({ type: "observation", content: result });

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log(`\n⚠️  Max steps (${MAX_STEPS}) reached`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 运行
reactLoop("What modules are in this Harness learning project?")
  .then(() => {
    console.log("\n--- 关键观察 ---");
    console.log("1. ReAct 每步：Thought → Action → Observation，循环直到完成");
    console.log("2. MAX_STEPS 是防止无限循环的硬性限制");
    console.log("3. 工具执行是真实的（读了你的文件系统），只有 LLM 是 mock 的");
    console.log("4. 手写这个 loop 很繁琐——这就是需要 harness 框架的原因");
  })
  .catch(console.error);
