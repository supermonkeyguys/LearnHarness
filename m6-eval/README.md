# M6：验证与评估系统

## 你要解决的问题

没有 eval 的 harness 是盲飞。你改了一个 prompt，不知道是变好了还是变坏了。你加了一个功能，不知道有没有破坏原有行为。Eval 是让 harness 可迭代的唯一手段——它把"感觉好像更好了"变成"通过率从 60% 提升到 85%"。

---

## 学习内容

### 6.1 Eval 的本质

- Eval 是 agent 系统的单元测试
- 确定性 eval vs 非确定性 eval
  - 确定性：输出完全匹配预期（适合结构化输出）
  - 非确定性：LLM judge 评分（适合自然语言输出）
- Eval 的三要素：输入（prompt）、预期输出（criteria）、评分方法
- 为什么 eval 比人工测试更重要

### 6.2 确定性验证

- Build 验证：`tsc --noEmit`（TypeScript 编译通过）
- Test 验证：`npm test`（单元测试通过）
- Lint 验证：`eslint`（代码风格）
- 自定义验证：业务规则检查
- 验证的组合：所有验证都通过才算通过

### 6.3 LLM Judge

- 什么时候需要 LLM judge：输出是自然语言或复杂代码
- Judge prompt 设计：给 LLM 明确的评分标准
- 评分维度：正确性、完整性、代码质量、安全性
- Judge 的偏见：LLM judge 倾向于给自己生成的内容高分
- 对抗性 judge：专门找问题的 judge

### 6.4 Eval 套件设计

- 测试用例的构成：简单用例 + 边界用例 + 回归用例
- 测试用例的来源：真实失败案例 > 人工构造
- 测试用例的维护：随着 harness 演进持续更新
- 通过率基线：新版本必须不低于上一版本

### 6.5 成本与质量 Tradeoff

- 模型路由：简单任务用便宜模型，复杂任务用强模型
- Eval 本身的成本：运行一次完整 eval 套件要多少钱
- 快速 eval vs 完整 eval：CI 中跑快速 eval，发布前跑完整 eval
- 成本预算：设定每次任务的最大 token 消耗

---

## 核心提问

1. 如果 LLM judge 给出的评分和人类评分不一致，应该相信谁？
2. 一个 eval 套件需要多少个测试用例才算"够用"？
3. Harness 改进了功能 A，但 eval 发现功能 B 的通过率下降了——怎么处理？
4. 如何防止 harness 对 eval 用例"过拟合"（专门针对测试用例优化）？
5. 什么时候值得花钱运行完整 eval，什么时候只运行快速 eval？

---

## 学完后应有的认知

> **核心认知**：Eval 是 harness 的免疫系统。没有 eval，每次改动都是在黑暗中摸索。有了 eval，你可以自信地迭代——因为你知道什么变好了，什么变坏了。Eval 把 AI 工程从"玄学"变成"科学"。

具体来说，你应该能：
- [ ] 说出确定性验证和 LLM judge 各自适合什么场景
- [ ] 设计一个包含 5 个测试用例的 eval 套件
- [ ] 实现一个简单的 LLM judge
- [ ] 解释模型路由的决策逻辑

---

## 参考资料

### 必读
- [Anthropic: Evaluating Claude](https://docs.anthropic.com/en/docs/build-with-claude/evaluate-outputs)
- [Building LLM evals — Hamel Husain](https://hamel.dev/blog/posts/evals/)（实践向，强烈推荐）

### 推荐
- [OpenAI Evals 框架](https://github.com/openai/evals)（了解工业级 eval 设计）
- [LLM-as-a-Judge 论文](https://arxiv.org/abs/2306.05685)（理解 LLM judge 的偏见和局限）

---

## 配套代码

见 `code/` 目录：

- `01-deterministic-validator.ts` — 运行 build/test/lint 并收集结果
- `02-llm-judge.ts` — LLM judge：评分代码质量
- `03-eval-suite.ts` — Eval 套件：管理和运行测试用例
- `04-model-router.ts` — 模型路由：根据任务复杂度选择模型

## 小实战 Demo

**目标**：为 M3 的 harness 构建一个 eval 套件。

要求：
1. 5 个测试用例（3 个正常用例，2 个边界用例）
2. 确定性验证：生成的 TypeScript 必须能编译
3. LLM judge：评估代码质量（1-5 分）
4. 通过标准：编译通过 + LLM judge ≥ 3 分
5. 输出报告：每个用例的通过/失败 + 原因

完成后你会理解：为什么 eval 是 harness 最难但最有价值的部分。
