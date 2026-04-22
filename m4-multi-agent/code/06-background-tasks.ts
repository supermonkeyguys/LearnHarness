export {};

/**
 * M4 - 后台任务系统
 *
 * 来源视角：learn-claude-code s08 (shareAI-lab)
 * 核心洞见："Run slow operations in the background; the agent keeps thinking"
 *
 * 与你已有的 01-dag.ts / 02-scheduler.ts 的区别：
 * - DAG 调度：所有任务都是 agent 发起的，await 等待结果
 * - 后台任务：agent 启动任务后立即继续工作，结果通过通知队列异步注入
 *
 * 适用场景：
 * - npm install / pip install（需要几分钟）
 * - 运行测试套件（可能很慢）
 * - 构建 Docker 镜像
 * - 任何 agent 不需要立即等待结果的操作
 *
 * 架构：
 *   主线程：agent loop（LLM 调用 + 工具执行）
 *   后台线程：subprocess 执行（Node.js 用 child_process + Promise）
 *   通知队列：后台任务完成后，结果在下一轮 loop 开始前注入 messages
 *
 *   Timeline:
 *   Agent ──[start A]──[start B]──[do other work]──[drain queue]──[LLM sees A,B results]
 *                |          |
 *                └──[A runs]└──[B runs]  (parallel, non-blocking)
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ---- 后台任务状态 ----

type TaskStatus = "running" | "done" | "failed" | "timeout";

interface BackgroundTask {
  id: string;
  command: string;
  status: TaskStatus;
  startedAt: number;
  output?: string;
  durationMs?: number;
}

interface Notification {
  taskId: string;
  status: TaskStatus;
  output: string;
  durationMs: number;
}

// ---- 后台任务管理器 ----

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private notificationQueue: Notification[] = [];
  private idCounter = 0;

  // 启动一个后台任务，立即返回 task ID（不等待执行完成）
  start(command: string, timeoutMs = 30_000): string {
    const id = `bg_${++this.idCounter}`;
    const task: BackgroundTask = {
      id,
      command,
      status: "running",
      startedAt: Date.now(),
    };
    this.tasks.set(id, task);

    // 在后台执行（不 await）
    this.executeInBackground(task, timeoutMs);

    return id;
  }

  private async executeInBackground(task: BackgroundTask, timeoutMs: number): Promise<void> {
    try {
      const result = await Promise.race([
        execAsync(task.command, { timeout: timeoutMs }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
        ),
      ]);

      const output = [(result as { stdout: string; stderr: string }).stdout, (result as { stdout: string; stderr: string }).stderr]
        .filter(Boolean)
        .join("\n")
        .trim()
        .slice(0, 2000);

      task.status = "done";
      task.output = output;
      task.durationMs = Date.now() - task.startedAt;

    } catch (e) {
      const msg = (e as Error).message;
      task.status = msg.includes("TIMEOUT") ? "timeout" : "failed";
      task.output = msg.slice(0, 500);
      task.durationMs = Date.now() - task.startedAt;
    }

    // 任务完成，推入通知队列
    this.notificationQueue.push({
      taskId: task.id,
      status: task.status,
      output: task.output ?? "",
      durationMs: task.durationMs ?? 0,
    });
  }

  // Agent loop 每轮开始前调用：取出所有待处理通知
  drainNotifications(): Notification[] {
    const notifications = [...this.notificationQueue];
    this.notificationQueue = [];
    return notifications;
  }

  getStatus(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  listAll(): BackgroundTask[] {
    return [...this.tasks.values()];
  }
}

// ---- Mock LLM（模拟 agent 在后台任务运行时继续工作）----

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: "user" | "assistant"; content: string | ContentBlock[] | ToolResultBlock[] };
type LLMResponse = { stop_reason: "end_turn" | "tool_use"; content: ContentBlock[] };

class MockAgentLLM {
  private step = 0;

  async call(messages: Message[]): Promise<LLMResponse> {
    this.step++;
    await sleep(100);

    // 检查是否有后台任务通知
    const lastMsg = messages[messages.length - 1];
    const hasNotification =
      typeof lastMsg?.content === "string" &&
      lastMsg.content.includes("<background-results>");

    switch (this.step) {
      // Step 1: 启动两个后台任务
      case 1:
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "I'll start the slow build in the background and continue with other work." },
            { type: "tool_use", id: "t1", name: "background_run", input: { command: "sleep 0.3 && echo 'build complete: 42 files compiled'" } },
          ],
        };

      // Step 2: 第一个任务启动了，再启动第二个，然后继续工作
      case 2:
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Build started. Now let me also run tests in background and create the config file meanwhile." },
            { type: "tool_use", id: "t2", name: "background_run", input: { command: "sleep 0.2 && echo 'tests: 15 passed, 0 failed'" } },
          ],
        };

      // Step 3: 在后台任务运行时做其他工作
      case 3:
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Both tasks running. Let me create the config file now (not waiting for background tasks)." },
            { type: "tool_use", id: "t3", name: "create_config", input: { content: '{"version": "1.0", "env": "production"}' } },
          ],
        };

      // Step 4+: 处理后台任务通知（如果有）或结束
      default:
        if (hasNotification) {
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Background tasks completed. Build and tests both passed. Config file created. All done!" }],
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Waiting for background tasks to complete..." }],
        };
    }
  }
}

// ---- Agent Loop（带后台任务通知注入）----

async function agentLoop(userMessage: string): Promise<void> {
  const bgManager = new BackgroundTaskManager();
  const llm = new MockAgentLLM();
  const messages: Message[] = [{ role: "user", content: userMessage }];

  console.log(`\nUser: ${userMessage}\n`);

  for (let turn = 0; turn < 10; turn++) {
    // 关键步骤：每轮 LLM 调用前，先注入已完成的后台任务通知
    const notifications = bgManager.drainNotifications();
    if (notifications.length > 0) {
      const notifText = notifications
        .map((n) => `[bg:${n.taskId}] ${n.status.toUpperCase()} (${n.durationMs}ms): ${n.output.slice(0, 100)}`)
        .join("\n");
      messages.push({ role: "user", content: `<background-results>\n${notifText}\n</background-results>` });
      console.log(`  [Loop] Injected ${notifications.length} notification(s) into context`);
    }

    const response = await llm.call(messages);

    const texts = response.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    if (texts.length > 0) console.log(`  [Agent] ${texts[0].text}`);

    if (response.stop_reason === "end_turn") {
      console.log("\n✅ Agent done");
      break;
    }

    // 处理工具调用
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use");
    const toolResults: ToolResultBlock[] = [];

    for (const block of toolUses) {
      let result: string;

      if (block.name === "background_run") {
        const command = block.input.command as string;
        const taskId = bgManager.start(command);
        result = `Background task ${taskId} started. Agent continues without waiting.`;
        console.log(`  [BG] Started task ${taskId}: "${command}"`);

      } else if (block.name === "create_config") {
        result = `Config created: ${block.input.content}`;
        console.log(`  [Tool] Created config file`);

      } else {
        result = `Unknown tool: ${block.name}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });

    // 等待一小段时间（让后台任务有机会完成）
    await sleep(150);
  }

  // 打印后台任务汇总
  console.log("\n--- Background Task Summary ---");
  bgManager.listAll().forEach((t) => {
    const icon = t.status === "done" ? "✅" : t.status === "failed" ? "❌" : "⏳";
    console.log(`  ${icon} [${t.id}] ${t.command.slice(0, 50)} — ${t.status} (${t.durationMs ?? "?"}ms)`);
    if (t.output) console.log(`       ${t.output.slice(0, 80)}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Background Tasks Demo ===");
  console.log("(learn-claude-code s08 pattern)\n");

  await agentLoop(
    "Start the build process and run tests in the background. While they run, create the production config file."
  );

  console.log("\n--- 关键观察（来自 learn-claude-code s08）---");
  console.log("1. Agent 不等待后台任务——启动后立即继续做其他工作");
  console.log("2. 通知队列（drainNotifications）是关键：每轮 loop 开始前注入完成的任务结果");
  console.log("3. 与 M4/01-dag.ts 的区别：DAG 是 await 等待，后台任务是 fire-and-forget");
  console.log("4. 真实场景：npm install + 同时写代码，测试运行 + 同时修其他 bug");
}

main().catch(console.error);
