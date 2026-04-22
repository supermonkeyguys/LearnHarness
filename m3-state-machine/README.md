# M3：状态机与执行流

## 你要解决的问题

裸 agent loop 没有阶段概念——它只是"一直跑直到停止"。这导致：任务到一半失败了不知道从哪恢复，质量没有检查点，无法预测行为。这个模块用状态机给 agent 执行流加上骨架。

---

## 学习内容

### 3.1 有限状态机（FSM）基础

- 状态（State）、转换（Transition）、事件（Event）
- FSM 的确定性：给定状态 + 事件 → 唯一的下一个状态
- 为什么 FSM 是 harness 执行流的天然模型
- 状态机 vs 流程图：两者的区别

### 3.2 Harness 的标准阶段模型

```
IDLE → PLANNING → EXECUTING → VERIFYING → [DONE | RETRYING | FAILED]
                                    ↑______________|
```

- PLANNING：分解任务，生成 plan
- EXECUTING：执行单个步骤
- VERIFYING：运行确定性验证（build/test/lint）
- RETRYING：失败后的 debug loop
- 每个阶段的进入条件和退出条件

### 3.3 质量门控（Quality Gates）

- 什么是质量门控：阶段转换的通过/失败标准
- 确定性验证 vs 非确定性验证
  - 确定性：`npm test` 通过/失败（客观）
  - 非确定性：LLM judge 评分（主观）
- 门控失败时的策略：重试 / 降级 / 人工介入
- 最大重试次数：防止无限循环的硬性限制

### 3.4 幂等性与断点续传

- 幂等性：同一个步骤执行两次，结果相同
- 为什么 harness 的每个步骤都应该是幂等的
- Checkpoint：在每个阶段结束时保存状态
- 断点续传：从最后一个成功的 checkpoint 恢复
- 任务 ID 与去重：防止重复执行

---

## 核心提问

1. 如果 EXECUTING 阶段写了一半文件然后崩溃，重启后怎么恢复？
2. 质量门控应该放在 EXECUTING 结束后，还是 VERIFYING 开始前？（有区别吗？）
3. 最大重试次数设为多少合适？依据是什么？
4. 一个非幂等的步骤（比如"发送邮件"）如何在 harness 中安全处理？
5. 状态机和 if-else 链有什么本质区别？为什么要用状态机？

---

## 学完后应有的认知

> **核心认知**：一个 agent 任务本质是一个状态机。Harness 定义状态转换规则，LLM 只负责在每个状态内执行具体工作。把"LLM 做什么"和"什么时候进入下一个阶段"分离，是让 agent 可控的关键。

具体来说，你应该能：
- [ ] 画出一个 harness 的状态转换图
- [ ] 说出每个状态的进入条件和退出条件
- [ ] 解释为什么幂等性对断点续传至关重要
- [ ] 设计一个简单的 checkpoint 机制

---

## 参考资料

### 必读
- [XState 文档 — 状态机概念](https://stately.ai/docs/state-machines-and-statecharts)（不需要学框架，只读概念部分）
- [Anthropic: Building effective agents — Workflows](https://www.anthropic.com/research/building-effective-agents)（Workflow 部分）

### 推荐
- Martin Fowler: [State Machine](https://martinfowler.com/bliki/StateMachine.html)
- [The Saga Pattern](https://microservices.io/patterns/data/saga.html)（分布式事务的状态管理，和 harness 思路相通）

---

## 配套代码

见 `code/` 目录：

- `01-fsm.ts` — 从零实现一个最小 FSM（不依赖任何库）
- `02-harness-states.ts` — 定义 harness 的五个标准状态和转换规则
- `03-checkpoint.ts` — 基于文件的 checkpoint 系统（保存/恢复状态）
- `04-quality-gate.ts` — 质量门控：运行命令并判断通过/失败

## 小实战 Demo

**目标**：把 M1 的裸 agent loop 重构为状态机驱动的 harness。

要求：
1. 明确的五个状态，每个状态有进入/退出日志
2. VERIFYING 阶段运行真实命令（`tsc --noEmit` 或 `npm test`）
3. 失败时进入 RETRYING，最多重试 3 次
4. 每个阶段结束后写 checkpoint 文件

完成后你会理解：为什么状态机是 harness 的骨架，以及"最小 harness v0"长什么样。

---

## 里程碑：最小 Harness v0

完成 M1 + M2 + M3 后，你应该能构建：

```
输入：一个任务描述（字符串）
执行：
  1. PLANNING — LLM 生成步骤列表
  2. EXECUTING — 逐步执行，每步调用 LLM
  3. VERIFYING — 运行 tsc 验证输出
  4. RETRYING — 失败则重试，最多 3 次
输出：完成的代码文件 + 执行日志
```

这是你第一个真实可运行的 harness。
