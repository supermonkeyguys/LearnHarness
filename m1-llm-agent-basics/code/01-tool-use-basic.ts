/**
 * M1 - 最简单的 Tool Use 示例（无需 API Key）
 *
 * 演示：让 LLM 调用一个加法工具
 * 核心概念：tool call 的完整生命周期
 *
 * 用 MockLLM 模拟真实 LLM 的行为：
 *   第1轮：LLM 决定调用 add(15, 27)
 *   第2轮：LLM 看到结果 42，决定调用 add(42, 8)
 *   第3轮：LLM 看到结果 50，给出最终回答
 */

// ---- 类型定义（模仿 Anthropic SDK 的结构）----

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ContentBlock = TextBlock | ToolUseBlock;

type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
};

type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

type LLMResponse = {
  stop_reason: "end_turn" | "tool_use";
  content: ContentBlock[];
};

// ---- Mock LLM（按脚本返回预设响应）----

export class MockLLM {
  private callCount = 0;

  // 模拟 LLM 的多轮推理过程
  async createMessage(messages: Message[]): Promise<LLMResponse> {
    this.callCount++;
    console.log(`\n  [MockLLM] Call #${this.callCount}, message history length: ${messages.length}`);

    // 第1轮：用户问"15+27 再加 8 是多少"，LLM 决定先算 15+27
    if (this.callCount === 1) {
      return {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I'll calculate this step by step. First, let me add 15 and 27." },
          { type: "tool_use", id: "call_001", name: "add", input: { a: 15, b: 27 } },
        ],
      };
    }

    // 第2轮：LLM 看到 add(15,27)=42，继续算 42+8
    if (this.callCount === 2) {
      return {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "15 + 27 = 42. Now let me add 8 to that." },
          { type: "tool_use", id: "call_002", name: "add", input: { a: 42, b: 8 } },
        ],
      };
    }

    // 第3轮：LLM 看到 add(42,8)=50，给出最终答案
    return {
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "The final answer is: 15 + 27 = 42, then 42 + 8 = 50." },
      ],
    };
  }
}

// ---- 工具的实际执行逻辑（LLM 不执行，harness 执行）----

function executeTool(name: string, input: Record<string, unknown>): string {
  if (name === "add") {
    const result = (input.a as number) + (input.b as number);
    console.log(`  [Tool] add(${input.a}, ${input.b}) = ${result}`);
    return String(result);
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ---- Agent Loop ----

async function runWithTools(userMessage: string): Promise<string> {
  const llm = new MockLLM();
  const messages: Message[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`\nUser: ${userMessage}`);

  // loop 直到 LLM 不再发出 tool call（stop_reason === 'end_turn'）
  while (true) {
    const response = await llm.createMessage(messages);

    console.log(`  LLM stop_reason: ${response.stop_reason}`);

    // 如果 LLM 完成了，返回最终文本
    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      console.log(`\nAssistant: ${text}`);
      return text;
    }

    // 如果 LLM 要调用工具
    if (response.stop_reason === "tool_use") {
      // 把 LLM 的 assistant 消息加入历史
      messages.push({ role: "assistant", content: response.content });

      // 找出所有 tool_use block
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use"
      );

      // 执行每个工具，收集结果
      const toolResults: ToolResultBlock[] = toolUseBlocks.map((block) => {
        console.log(`\n  [Harness] Executing tool: ${block.name}`);
        const result = executeTool(block.name, block.input);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        };
      });

      // 把工具结果作为 user 消息返回给 LLM
      messages.push({ role: "user", content: toolResults });
    }
  }
}

// 运行
runWithTools("What is 15 + 27? And then what is that result plus 8?")
  .then(() => {
    console.log("\n--- 关键观察 ---");
    console.log("1. MockLLM 模拟了真实 LLM 的多轮推理");
    console.log("2. LLM 不执行工具——它只输出「我想调用 add(15, 27)」");
    console.log("3. Harness（你的代码）执行实际的加法，把结果告诉 LLM");
    console.log("4. 这个循环就是 agent loop 的本质");
  })
  .catch(console.error);
