# M5：持久化与 Session 管理

## 你要解决的问题

LLM 是无状态的。Context window 满了就忘。任务被打断就从头开始。这个模块解决 harness 的"记忆问题"：如何让 agent 跨步骤、跨 session 保持必要的上下文，同时不让 context 被无关信息淹没。

---

## 学习内容

### 5.1 三种记忆类型

```
Working Memory    → Context window（当前对话）
Episodic Memory   → Session 文件（发生了什么）
Semantic Memory   → 知识库（学到了什么）
```

- Working Memory：当前 context，最贵，最快，有限
- Episodic Memory：任务历史、决策记录、中间结果
- Semantic Memory：代码库理解、项目约定、学到的模式
- 三者的读写时机和成本差异

### 5.2 Context 压缩策略

- 为什么不能把所有历史都塞进 context
- Summarization：用 LLM 把长历史压缩成摘要
- Selective Retention：只保留当前步骤需要的信息
- Sliding Window：只保留最近 N 轮对话
- 压缩的时机：什么时候触发压缩

### 5.3 Checkpoint 系统（进阶）

- Checkpoint 应该保存什么：状态、进度、中间结果
- Checkpoint 格式设计：可读性 vs 紧凑性
- 恢复策略：从 checkpoint 重建 context
- Checkpoint 清理：任务完成后如何处理旧的 checkpoint

### 5.4 Session 管理

- Session 的生命周期：创建、运行、暂停、恢复、完成
- Session ID：唯一标识一个任务执行
- 跨 session 传递：如何把上一个 session 的关键信息带入新 session
- Session 日志：完整记录每个决策和操作（可审计）

### 5.5 外部 Memory 系统

- 文件系统作为 memory（简单但够用）
- 向量数据库：语义搜索历史信息（适合大型项目）
- 什么时候需要向量数据库，什么时候文件够用
- Memory 的读取策略：全量加载 vs 按需检索

---

## 核心提问

1. 一个运行了 2 小时的任务突然崩溃，最多丢失多少工作？如何最小化损失？
2. Summarization 会丢失信息——如何决定哪些信息可以丢，哪些必须保留？
3. 如果 semantic memory 中有错误的信息，agent 会被误导——如何防止？
4. Context 压缩本身也消耗 token，如何权衡压缩成本和节省的 context 空间？
5. 多个并行 subagent 共享 memory 时，如何防止写冲突？

---

## 学完后应有的认知

> **核心认知**：Context window 是 agent 的 RAM，磁盘是持久存储。Memory 系统是 harness 的操作系统内核——它决定了 agent 在任何时刻"知道什么"。好的 memory 系统让 agent 在有限的 context 内做出最优决策。

具体来说，你应该能：
- [ ] 说出三种记忆类型及其读写时机
- [ ] 设计一个 checkpoint 的数据结构
- [ ] 解释 summarization 的触发条件和实现方式
- [ ] 画出一个 session 的完整生命周期图

---

## 参考资料

### 必读
- [Anthropic: Context window management](https://docs.anthropic.com/en/docs/build-with-claude/context-windows)
- [MemGPT 论文](https://arxiv.org/abs/2310.08560)（理解分层 memory 架构，读 Abstract + Figure 1）

### 推荐
- [LangChain Memory 文档](https://python.langchain.com/docs/concepts/memory/)（概念部分）
- [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)（综述论文，了解全局）

---

## 配套代码

见 `code/` 目录：

- `01-memory-types.ts` — 三种 memory 的接口定义和简单实现
- `02-context-compressor.ts` — 基于 LLM 的 context 压缩器
- `03-session-manager.ts` — Session 生命周期管理
- `04-checkpoint-v2.ts` — 完整 checkpoint 系统（含恢复逻辑）

## 小实战 Demo

**目标**：让 M3 的 harness 支持断点续传。

要求：
1. 每个阶段完成后写 checkpoint（JSON 文件）
2. 启动时检查是否有未完成的 checkpoint，有则从断点继续
3. 实现简单的 context 压缩：超过 50k token 时自动摘要历史
4. Session 日志：每个操作都有时间戳和结果记录

完成后你会理解：为什么"状态持久化"是 harness 最容易被忽视但最关键的部分。
