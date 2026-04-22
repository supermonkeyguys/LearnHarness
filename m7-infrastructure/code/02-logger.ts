/**
 * M7 - 结构化日志系统
 *
 * 核心概念：
 * - 结构化日志（JSON）比文本日志更易于查询和分析
 * - 日志级别：DEBUG < INFO < WARN < ERROR
 * - 关键日志点：状态转换、工具调用、LLM 调用、错误
 */

import * as fs from "fs";
import * as path from "path";

// ---- 日志级别 ----

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3,
};

// ---- 日志条目 ----

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;   // 哪个模块产生的日志
  message: string;
  data?: Record<string, unknown>;
  sessionId?: string;
  taskId?: string;
  durationMs?: number;
}

// ---- 日志输出器（Sink）----

interface LogSink {
  write(entry: LogEntry): void;
}

// Console sink：彩色输出到终端
class ConsoleSink implements LogSink {
  private colors: Record<LogLevel, string> = {
    DEBUG: "\x1b[37m",  // 灰色
    INFO:  "\x1b[36m",  // 青色
    WARN:  "\x1b[33m",  // 黄色
    ERROR: "\x1b[31m",  // 红色
  };
  private reset = "\x1b[0m";

  write(entry: LogEntry): void {
    const color = this.colors[entry.level];
    const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
    const component = entry.component.padEnd(16).slice(0, 16);
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    const duration = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : "";
    console.log(`${color}${time} [${entry.level.padEnd(5)}] [${component}] ${entry.message}${duration}${data}${this.reset}`);
  }
}

// File sink：写到 JSON Lines 文件
class FileSink implements LogSink {
  private stream: fs.WriteStream;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  write(entry: LogEntry): void {
    this.stream.write(JSON.stringify(entry) + "\n");
  }

  close(): void {
    this.stream.end();
  }
}

// ---- Logger ----

class Logger {
  private sinks: LogSink[] = [];
  private minLevel: LogLevel;
  private defaultContext: Partial<LogEntry> = {};

  constructor(minLevel: LogLevel = "INFO") {
    this.minLevel = minLevel;
  }

  addSink(sink: LogSink): this {
    this.sinks.push(sink);
    return this;
  }

  withContext(context: Partial<Pick<LogEntry, "sessionId" | "taskId" | "component">>): Logger {
    const child = new Logger(this.minLevel);
    child.sinks = this.sinks;
    child.defaultContext = { ...this.defaultContext, ...context };
    return child;
  }

  private log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>, durationMs?: number): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.defaultContext.component ?? component,
      message,
      ...(data ? { data } : {}),
      ...(this.defaultContext.sessionId ? { sessionId: this.defaultContext.sessionId } : {}),
      ...(this.defaultContext.taskId ? { taskId: this.defaultContext.taskId } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };

    this.sinks.forEach((s) => s.write(entry));
  }

  debug(component: string, message: string, data?: Record<string, unknown>) { this.log("DEBUG", component, message, data); }
  info (component: string, message: string, data?: Record<string, unknown>) { this.log("INFO",  component, message, data); }
  warn (component: string, message: string, data?: Record<string, unknown>) { this.log("WARN",  component, message, data); }
  error(component: string, message: string, data?: Record<string, unknown>) { this.log("ERROR", component, message, data); }

  // 计时日志：自动记录操作耗时
  async timed<T>(component: string, message: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.log("INFO", component, message, undefined, Date.now() - start);
      return result;
    } catch (e) {
      this.log("ERROR", component, `${message} FAILED`, { error: (e as Error).message }, Date.now() - start);
      throw e;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Logger Demo ===\n");

  const logFile = path.join(__dirname, "../../.tmp/harness.log");

  const logger = new Logger("DEBUG")
    .addSink(new ConsoleSink())
    .addSink(new FileSink(logFile));

  // 基本日志
  logger.debug("FSM", "State check", { state: "IDLE" });
  logger.info("Harness", "Task submitted", { taskId: "task-001", description: "Implement auth" });
  logger.warn("Context", "Usage at 75%", { usedTokens: 150_000, maxTokens: 200_000 });
  logger.error("Subagent", "Tool call failed", { tool: "read_file", error: "ENOENT: no such file" });

  // 带 context 的子 logger（自动附加 sessionId）
  console.log();
  const sessionLogger = logger.withContext({ sessionId: "sess-abc123", component: "Session" });
  sessionLogger.info("Session", "Started");
  sessionLogger.info("Session", "Step 1 complete");

  // 计时日志
  console.log();
  await logger.timed("LLM", "Generate code", async () => {
    await sleep(120);
    return "export function foo() {}";
  });

  await logger.timed("LLM", "Failing operation", async () => {
    await sleep(50);
    throw new Error("API rate limit exceeded");
  }).catch(() => {});

  // 显示写入的日志文件
  console.log(`\nLog file: ${logFile}`);
  const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
  console.log(`Entries written: ${lines.length}`);
  console.log("Sample entry:", lines[1]);

  // 清理
  fs.rmSync(path.dirname(logFile), { recursive: true, force: true });

  console.log("\n--- 关键观察 ---");
  console.log("1. JSON Lines 格式（每行一个 JSON）便于 grep 和日志分析工具处理");
  console.log("2. withContext() 让子模块自动附加 sessionId/taskId，不需要每次传参");
  console.log("3. timed() 自动记录耗时，失败时也记录 ERROR，不需要手写 try/catch");
  console.log("4. 多 sink：同时输出到终端（彩色）和文件（JSON），互不干扰");
}

main().catch(console.error);
