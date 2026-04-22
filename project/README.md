# 最终项目：PRD → 代码 Harness

> 这是学完全部 7 个模块后构建的完整 harness。
> 在开始之前，确保你已经完成并理解了所有模块的 demo。

## 目标

```
输入：PRD 文档（Markdown 格式）
输出：可运行的 TypeScript 代码实现 + 测试 + 执行报告
```

## 架构

```
PRD Input
    │
    ▼
┌─────────────────────────────────────┐
│           Orchestrator              │
│  - 解析 PRD                         │
│  - 生成任务 DAG                      │
│  - 调度 subagents                   │
│  - 合并结果                          │
└──────────────┬──────────────────────┘
               │ dispatches
       ┌───────┼───────┐
       ▼       ▼       ▼
  [Subagent] [Subagent] [Subagent]
  各自独立执行，有：
  - 状态机（M3）
  - Checkpoint（M5）
  - Context 压缩（M5）
  - 质量门控（M6）
  - Hook 系统（M7）
       │       │       │
       └───────┼───────┘
               │ results
               ▼
        ┌─────────────┐
        │  Integrator │
        │  - 合并代码  │
        │  - 运行 eval │
        │  - 生成报告  │
        └─────────────┘
               │
               ▼
          Final Output
```

## 构建顺序

完成各模块后，按以下顺序组装：

1. **v0.1** — 单 agent，状态机，基本 tool use（M1 + M3）
2. **v0.2** — 加入结构化 prompt（M2）
3. **v0.3** — 加入 checkpoint 和断点续传（M5）
4. **v0.4** — 拆分为 orchestrator + subagents（M4）
5. **v0.5** — 加入 eval 套件（M6）
6. **v1.0** — 加入完整基础设施层（M7）

## 文件结构（待构建）

```
project/
├── README.md           # 本文件
├── src/
│   ├── orchestrator.ts # 任务分解与调度
│   ├── subagent.ts     # 单任务执行 agent
│   ├── fsm.ts          # 状态机
│   ├── memory.ts       # Memory 系统
│   ├── hooks.ts        # Hook 系统
│   ├── eval.ts         # Eval 套件
│   └── index.ts        # 入口
├── prompts/
│   ├── orchestrator.md # Orchestrator system prompt
│   └── subagent.md     # Subagent system prompt
├── evals/
│   └── cases/          # 测试用例
├── harness.config.ts   # 配置文件
└── package.json
```

## 里程碑检验

当你能用这个 harness 完成以下任务时，说明它真正可用：

- [ ] 给一个 5 行的 PRD，生成可编译的 TypeScript 实现
- [ ] 任务中途中断，重启后从断点继续
- [ ] 一个 subagent 失败，其他继续运行
- [ ] Eval 通过率 ≥ 80%
- [ ] 完整执行日志，每个决策可追溯
