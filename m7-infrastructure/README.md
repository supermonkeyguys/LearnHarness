# M7：工程化基础设施

## 你要解决的问题

Harness 本身也是软件。如果它崩溃了你不知道，如果它做了危险操作你无法阻止，如果它的行为不可追溯你无法调试——那它只是一个更复杂的黑盒。这个模块把 harness 变成一个可观测、可控制、可维护的工程系统。

---

## 学习内容

### 7.1 Hook 系统

- 什么是 hook：在特定事件前后注入自定义逻辑
- Pre-hook：工具调用前执行（验证、日志、权限检查）
- Post-hook：工具调用后执行（结果验证、副作用清理）
- Hook 的用途：
  - 安全检查：拦截危险操作
  - 日志：记录每个决策
  - 指标收集：统计 token 消耗、延迟
  - 人工介入：需要确认时暂停

```typescript
// Hook 示例
harness.addHook('before:tool_call', async (tool, args) => {
  if (tool === 'delete_file') {
    await requireHumanApproval(`About to delete: ${args.path}`)
  }
})
```

### 7.2 可观测性

- 日志（Logging）：记录发生了什么
  - 结构化日志（JSON）vs 文本日志
  - 日志级别：DEBUG / INFO / WARN / ERROR
  - 关键日志点：每个状态转换、每个 tool call、每个 LLM 调用
- 指标（Metrics）：量化系统状态
  - Token 消耗（按模型、按任务）
  - 延迟（端到端、每个阶段）
  - 成功率、重试率、失败原因分布
- 追踪（Tracing）：还原完整执行路径
  - 每个 LLM 调用的 request/response
  - 工具调用链
  - 决策树

### 7.3 安全边界

- 哪些操作需要人工确认（删除文件、推送代码、发送请求）
- 哪些操作应该被禁止（访问生产数据库、执行任意 shell 命令）
- 沙箱：限制 harness 能访问的资源范围
- 速率限制：防止 harness 失控时消耗大量 API 配额
- 审计日志：所有操作都可追溯，不可篡改

### 7.4 错误处理与恢复

- 错误分类：
  - 可重试错误（网络超时、API 限流）
  - 不可重试错误（无效输入、权限不足）
  - 需要人工介入的错误（逻辑矛盾、资源不足）
- 指数退避：重试时的等待策略
- 熔断器（Circuit Breaker）：连续失败时停止重试
- 优雅降级：部分功能失败时如何继续

### 7.5 配置管理

- Harness 的配置项：模型选择、重试次数、超时、工具权限
- 配置文件格式：YAML / JSON / TypeScript
- 环境变量：敏感配置（API keys）不进配置文件
- 配置验证：启动时检查配置是否完整有效

---

## 核心提问

1. 如果 harness 在凌晨 3 点自动运行并删除了错误的文件，你怎么知道发生了什么？
2. Hook 系统和直接在代码里加 if-else 有什么本质区别？
3. 什么操作应该需要人工确认？判断标准是什么？
4. 如果 API 限流了，harness 应该等多久再重试？
5. 可观测性数据本身也有成本——如何决定记录什么，不记录什么？

---

## 学完后应有的认知

> **核心认知**：Harness 是软件，需要按软件工程标准对待。可观测性不是可选项——没有日志的 harness 在生产环境中是不可维护的。安全边界不是过度谨慎——它是防止 agent 失控的最后一道防线。

具体来说，你应该能：
- [ ] 实现一个简单的 hook 系统
- [ ] 说出 harness 中至少 5 个关键日志点
- [ ] 设计一个需要人工确认的操作白名单
- [ ] 实现带指数退避的重试逻辑

---

## 参考资料

### 必读
- [Claude Code hooks 文档](https://docs.anthropic.com/en/docs/claude-code/hooks)（直接参考真实 harness 的 hook 设计）
- [The Twelve-Factor App](https://12factor.net/)（工程化基础设施的经典参考，重点看 Logs 和 Config）

### 推荐
- [OpenTelemetry 概念](https://opentelemetry.io/docs/concepts/)（了解现代可观测性标准）
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)（Martin Fowler）

---

## 配套代码

见 `code/` 目录：

- `01-hook-system.ts` — 事件驱动的 hook 系统实现
- `02-logger.ts` — 结构化日志系统（JSON 格式，支持级别）
- `03-metrics.ts` — 指标收集：token 消耗、延迟、成功率
- `04-retry.ts` — 带指数退避和熔断器的重试逻辑
- `05-config.ts` — 配置管理：加载、验证、类型安全

## 小实战 Demo

**目标**：给完整 harness 加上基础设施层。

要求：
1. Hook 系统：pre/post tool call 都有日志
2. 安全 hook：`delete_file` 和 `exec_command` 需要人工确认
3. 指标：每次任务结束后打印 token 消耗和耗时报告
4. 重试：所有 API 调用都有指数退避重试（最多 3 次）
5. 配置文件：所有可调参数都在 `harness.config.ts` 中

完成后你会理解：为什么基础设施层是 harness 从"玩具"变成"生产系统"的关键。

---

## 里程碑：完整 Harness

完成全部 7 个模块后，你应该能构建：

```
输入：PRD 文档（Markdown）
执行：
  1. Orchestrator 解析 PRD，生成任务 DAG
  2. 并行调度多个 subagent 执行独立任务
  3. 每个 subagent 有状态机、checkpoint、context 压缩
  4. 质量门控：编译 + 测试 + LLM judge
  5. 失败时隔离重试，不影响其他任务
  6. 全量 eval 验证最终结果
  7. 完整日志 + 指标报告
输出：可运行的代码实现 + 执行报告
```
