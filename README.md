# Harness 学习计划

## 目标

构建一个能真实运行的 harness：**输入 PRD → 输出可运行的代码实现**。

## 学习路径

```
M1 LLM Agent 基础
    ↓
M2 Prompt 工程化
    ↓
M3 状态机与执行流
    ↓
[最小 harness v0 — 在此验证前三个模块]
    ↓
M4 多 Agent 架构
    ↓
M5 持久化与 Session 管理
    ↓
M6 验证与评估系统
    ↓
M7 工程化基础设施
    ↓
[完整 harness — PRD → 代码]
```

## 目录结构

```
Harness/
├── README.md                   # 本文件
├── m1-llm-agent-basics/        # LLM Agent 基础
├── m2-prompt-engineering/      # Prompt 工程化
├── m3-state-machine/           # 状态机与执行流
├── m4-multi-agent/             # 多 Agent 架构
├── m5-persistence/             # 持久化与 Session 管理
├── m6-eval/                    # 验证与评估系统
├── m7-infrastructure/          # 工程化基础设施
└── project/                    # 最终项目：PRD → 代码 harness
```

## 每个模块的结构

```
mX-xxx/
├── README.md      # 学习指南（学什么、提问、认知目标、参考资料）
├── concepts/      # 概念说明文档
├── code/          # 配套代码/伪代码
└── demo/          # 可运行的小 demo（TypeScript）
```

## 完成标准

每个模块结束后，你应该能用自己的话回答模块末尾的"认知检验问题"，并且 demo 代码能跑通。
