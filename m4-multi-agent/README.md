# M4：多 Agent 架构

## 你要解决的问题

单 agent 是瓶颈：它只能串行执行，context 会被所有任务污染，一个步骤失败会影响整个任务。多 agent 架构把大任务分解成独立的小任务并行执行——但这引入了新问题：如何协调、如何合并结果、如何处理冲突。

---

## 学习内容

### 4.1 Orchestrator / Subagent 模式

- Orchestrator：负责任务分解、调度、结果合并（不写代码）
- Subagent：负责执行单个具体任务（不知道全局）
- 两者的职责分离：为什么 orchestrator 不应该自己执行任务
- 通信方式：orchestrator 如何向 subagent 传递任务和接收结果

### 4.2 任务分解与 DAG

- 什么是 DAG（有向无环图）：任务依赖关系的表示
- 独立任务 vs 依赖任务：哪些可以并行，哪些必须串行
- 任务粒度：太细（overhead 大）vs 太粗（并行度低）
- 任务描述的标准格式：让 subagent 能独立执行

```
DAG 示例（PRD → 代码）：
  parse_prd
      ↓
  ┌───┴───┐
  design_api  design_schema
      ↓           ↓
  impl_routes  impl_models
      └───┬───┘
      write_tests
          ↓
       integrate
```

### 4.3 隔离策略

- 为什么 subagent 需要隔离：防止相互污染
- Git worktree：每个 subagent 在独立的工作目录操作
- 文件锁：防止多个 subagent 同时写同一个文件
- Context 隔离：每个 subagent 只看到自己需要的信息

### 4.4 结果合并与冲突解决

- 合并策略：orchestrator 如何合并多个 subagent 的输出
- 合并冲突：两个 subagent 修改了同一个文件
- 冲突解决策略：自动合并 / 人工介入 / 重新规划
- 集成验证：合并后需要重新运行全量测试

### 4.5 失败处理

- 单个 subagent 失败不应该导致整个任务失败
- 失败隔离：识别哪些任务失败，只重试失败的部分
- 补偿任务：某个任务失败后需要撤销已完成的相关任务

---

## 核心提问

1. Orchestrator 应该知道 subagent 的实现细节吗？为什么？
2. 如果两个 subagent 都需要修改 `utils.ts`，应该怎么设计任务？
3. DAG 中出现循环依赖（A 依赖 B，B 依赖 A）怎么处理？
4. Subagent 的 context 应该包含什么？不应该包含什么？
5. 并行执行 5 个 subagent，成本是单 agent 的 5 倍吗？

---

## 学完后应有的认知

> **核心认知**：多 agent 是并发工程问题，不是 AI 问题。隔离、同步、合并冲突——这些问题在分布式系统里已经被研究了几十年。Harness 的多 agent 层本质是一个简化的分布式任务调度系统。

具体来说，你应该能：
- [ ] 画出一个 PRD 任务的 DAG 分解图
- [ ] 解释 orchestrator 和 subagent 的职责边界
- [ ] 说出至少两种隔离策略及其适用场景
- [ ] 设计一个简单的合并冲突解决流程

---

## 参考资料

### 必读
- [Anthropic: Building effective agents — Multi-agent systems](https://www.anthropic.com/research/building-effective-agents)
- [Claude Code subagent 设计](https://docs.anthropic.com/en/docs/claude-code/sub-agents)

### 推荐
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/)（重点看 Graph 和 Node 的概念）
- [MapReduce 论文](https://research.google/pubs/mapreduce-simplified-data-processing-on-large-clusters/)（多 agent 的思路和 MapReduce 高度相似）
- [Git worktree 文档](https://git-scm.com/docs/git-worktree)

---

## 配套代码

见 `code/` 目录：

- `01-dag.ts` — DAG 数据结构：定义任务依赖关系
- `02-scheduler.ts` — 简单调度器：找出可以并行执行的任务
- `03-orchestrator.ts` — Orchestrator：分解任务并调度 subagent
- `04-subagent.ts` — Subagent：接收任务描述并独立执行
- `05-merge.ts` — 结果合并：处理多个 subagent 的输出

## 小实战 Demo

**目标**：用多 agent 架构实现"给定一个 TypeScript 接口定义，并行生成实现文件 + 测试文件"。

要求：
1. Orchestrator 分解为两个独立 subagent：impl_agent 和 test_agent
2. 两个 subagent 并行执行（Promise.all）
3. Orchestrator 合并结果，运行 `tsc` 验证
4. 如果任一 subagent 失败，只重试失败的那个

完成后你会理解：并行执行带来的速度提升，以及合并时的复杂度。

### 4.6 后台任务（来自 Claude Code 实际架构）

> 参考：[learn-claude-code s08](https://github.com/shareAI-lab/learn-claude-code) — *"Run slow operations in the background; the agent keeps thinking"*

与 DAG 调度（await 等待）不同，后台任务是 fire-and-forget：

```
DAG 调度：  agent → [await task A] → [await task B] → done
后台任务：  agent → [start A] → [start B] → [do other work] → [drain notifications]
                        ↓              ↓
                    [A runs]       [B runs]   (parallel, non-blocking)
```

关键机制：**通知队列** — 后台任务完成后推入队列，agent loop 每轮开始前 drain 并注入 context。

适用场景：npm install、运行测试、Docker 构建等耗时操作。

见 `code/06-background-tasks.ts`

### 4.7 团队协议（来自 Claude Code 实际架构）

> 参考：[learn-claude-code s09/s10](https://github.com/shareAI-lab/learn-claude-code) — *"Teammates need shared communication rules"*

Orchestrator 模式是单向的（lead 分发，subagent 执行）。真实多 agent 系统需要双向协议：

**Shutdown 握手**：不能直接 kill 正在写文件的 agent
```
lead → shutdown_request(reqId) → agent
lead ← shutdown_response(reqId, approve=true) ← agent（完成当前工作后）
```

**Plan 审批**：高风险操作（删文件、重构核心模块）需要 lead 审批
```
agent → plan_request(reqId, plan) → lead
agent ← plan_response(reqId, approve/reject, feedback) ← lead
```

共同的 FSM：`pending → approved | rejected`

通信机制：JSONL 邮箱（每个 agent 一个文件，append-only，无需消息队列服务）

见 `code/07-team-protocols.ts`
