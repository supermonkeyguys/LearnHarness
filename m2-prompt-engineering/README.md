# M2：Prompt 工程化

## 你要解决的问题

Harness 的行为完全由 prompt 决定。但大多数人写 prompt 像写聊天消息——随意、不可测试、不可版本控制。这个模块的目标是让你把 prompt 当成**配置文件**来对待。

---

## 学习内容

### 2.1 System Prompt 结构设计

- 角色定义（Role）：给 LLM 一个清晰的身份
- 约束边界（Constraints）：明确说"不做什么"比说"做什么"更重要
- 输出格式（Output Format）：结构化输出是 harness 解析的基础
- 上下文注入（Context Injection）：动态插入任务相关信息

### 2.2 输出结构化

- 为什么要用 XML tags / JSON schema 约束输出
- `<thinking>` 标签：让 LLM 先推理再行动
- 结构化输出 vs 自由文本：各自适合什么场景
- 解析失败的处理策略

### 2.3 Few-shot 与 Chain-of-Thought

- Few-shot：给例子比给说明更有效
- Chain-of-Thought (CoT)：让 LLM 展示推理过程
- Zero-shot CoT："Let's think step by step" 为什么有效
- 什么时候用 few-shot，什么时候用 CoT，什么时候两者都用

### 2.4 Prompt 版本控制与测试

- Prompt 是代码，应该被 git 管理
- Prompt 测试：给定输入，验证输出是否符合预期
- A/B 测试 prompt 变体
- Prompt 回归：改了 prompt 后如何确保没有破坏原有行为

---

## 核心提问

1. 同样的意图，"请帮我写代码" vs 一个 200 字的结构化 system prompt，差距在哪？
2. 如果 LLM 输出了不符合格式的内容，harness 应该怎么处理？
3. 为什么"不要做 X"的约束有时候反而会让 LLM 更容易做 X？
4. Prompt 版本升级时，如何保证不影响已有的 agent 行为？
5. Few-shot 的例子质量比数量更重要——如何选择好的例子？

---

## 学完后应有的认知

> **核心认知**：Prompt 是 harness 的配置文件，不是聊天消息。一个好的 harness prompt 应该是可测试的、可版本控制的、输出是可解析的。写 prompt 和写代码一样需要工程纪律。

具体来说，你应该能：
- [ ] 写出一个包含 Role / Constraints / Output Format / Context 四部分的 system prompt
- [ ] 解释为什么结构化输出对 harness 至关重要
- [ ] 设计一个简单的 prompt 测试用例
- [ ] 说出至少两种让 LLM 输出更稳定的技巧

---

## 参考资料

### 必读
- [Anthropic Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Claude's extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)（理解 `<thinking>` 的作用）

### 推荐
- [Prompt injection attacks](https://simonwillison.net/2023/Apr/14/prompt-injection/)（了解 prompt 的安全边界）
- OpenAI Cookbook: Techniques to improve reliability

---

## 配套代码

见 `code/` 目录：

- `01-structured-output.ts` — 强制 LLM 输出 JSON，并处理格式错误
- `02-system-prompt-template.ts` — 可复用的 system prompt 模板系统
- `03-prompt-tester.ts` — 简单的 prompt 测试框架（给定输入验证输出）

## 小实战 Demo

**目标**：为 M1 的 demo agent 设计一套可测试的 prompt 体系。

要求：
1. System prompt 有明确的四部分结构
2. 所有输出都是结构化的（可被程序解析）
3. 至少写 3 个测试用例验证 prompt 行为

完成后你会理解：为什么 prompt 设计是 harness 最难迭代的部分。

### 2.5 Skill 按需加载（来自 Claude Code 实际架构）

> 参考：[learn-claude-code s05](https://github.com/shareAI-lab/learn-claude-code) — *"Load knowledge when you need it, not upfront"*

这是 02-system-prompt-template.ts（静态模板）的进阶版本。

**问题**：把所有领域知识塞进 system prompt，每次调用都浪费 token：
```
10 个 skill × 2000 tokens = 20,000 tokens（大部分任务根本用不到）
```

**解决方案：两层架构**
```
Layer 1 (system prompt, 始终存在):
  - git-workflow: Git branching and commit conventions    ~10 tokens/skill
  - code-review:  Code review checklist and standards
  - testing:      Testing patterns and best practices

Layer 2 (tool_result, 按需注入):
  当 LLM 调用 load_skill("git-workflow") 时
  → 完整的 2000 token skill 内容通过 tool_result 注入
```

这正是 Claude Code 的 `/skill` 命令的工作原理。

见 `code/04-skill-loader.ts`
