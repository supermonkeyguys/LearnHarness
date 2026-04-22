# M1：LLM Agent 基础

## 你要解决的问题

在构建 harness 之前，你必须理解你在约束的对象是什么。LLM 不是确定性程序——它是一个概率函数。Harness 的本质是把不确定的概率函数变成确定性的工程系统。

---

## 学习内容

### 1.1 LLM 的工作方式

- Token 是什么，为什么它决定了 LLM 的一切限制
- Context window：LLM 的"工作内存"，满了就忘
- Temperature / Top-p：为什么 LLM 的输出是概率性的
- 为什么同样的 prompt 两次运行结果不同

### 1.2 Tool Use / Function Calling

- LLM 如何"调用工具"（本质是输出结构化文本，由外部执行）
- Tool call 的完整生命周期：request → execution → result → next step
- Parallel tool calls vs sequential tool calls
- Tool 的设计原则：原子性、幂等性、有明确返回值

### 1.3 ReAct 模式

- Reasoning + Acting 交替循环
- Thought → Action → Observation → Thought → ...
- 为什么 ReAct 比"一次性生成所有代码"更可靠
- ReAct 的失败模式：无限循环、幻觉 action

### 1.4 Agent Loop

- 什么是 agentic loop（模型驱动的执行循环）
- 停止条件：如何判断任务完成
- Token 消耗与成本模型：一个 agent 任务大概花多少钱
- Context 管理：当 context 快满时怎么办

---

## 核心提问（学习时带着这些问题）

1. LLM 调用一个工具时，"执行"这个动作是谁做的？
2. 如果 tool call 失败了，LLM 怎么知道？
3. 一个 agent loop 什么情况下会"卡死"？怎么预防？
4. 为什么不能无限扩大 context window 来解决所有问题？
5. ReAct 和直接让 LLM 生成完整答案，各自适合什么场景？

---

## 学完后应有的认知

> **核心认知**：LLM 是无状态的文本预测器。每次调用都是独立的。"记忆"、"理解"、"执行"都是幻觉——它只是在预测下一个 token。Harness 的工作就是在这个无状态函数外面包一层有状态的工程系统。

具体来说，你应该能回答：
- [ ] 解释为什么 context window 是 harness 设计的核心约束
- [ ] 画出一个 tool use 的完整时序图
- [ ] 说出 ReAct 模式的三个组成部分及其作用
- [ ] 估算一个简单 agent 任务的 token 消耗

---

## 参考资料

### 必读
- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/tool-use)
- [ReAct 论文](https://arxiv.org/abs/2210.03629)（读 Abstract + Introduction + 图1 即可）
- [Building effective agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)

### 推荐
- [What are tokens? — OpenAI Cookbook](https://cookbook.openai.com/articles/what_are_tokens_and_how_to_count_them)
- Anthropic Claude API 文档中的 Messages API 部分

---

## 配套代码

见 `code/` 目录：

- `01-tool-use-basic.ts` — 最简单的 tool call：让 LLM 调用一个加法函数
- `02-react-loop.ts` — 手动实现一个 ReAct loop（不依赖任何框架）
- `03-token-counter.ts` — 估算 token 消耗的工具函数

## 小实战 Demo

见 `demo/` 目录：

**目标**：实现一个能自主完成"查文件 → 分析内容 → 写摘要"的 agent，不用任何框架，只用 Anthropic SDK + 手写 loop。

完成后你会理解：为什么手写 agent loop 很痛苦，以及 harness 要解决的第一个问题是什么。
