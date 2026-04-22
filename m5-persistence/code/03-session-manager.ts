/**
 * M5 - Session 管理器
 *
 * 核心概念：
 * - Session = 一次完整任务的执行单元
 * - 生命周期：created → running → paused → completed / failed
 * - 跨 session 传递：把上一个 session 的关键信息带入新 session
 */

import * as fs from "fs";
import * as path from "path";

// ---- Session 数据结构 ----

type SessionStatus = "created" | "running" | "paused" | "completed" | "failed";

interface SessionLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

interface Session {
  id: string;
  taskDescription: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // 进度
  totalSteps: number;
  completedSteps: number;

  // 关键决策记录（跨 session 传递用）
  keyDecisions: Array<{ step: string; decision: string; reason: string }>;

  // 日志
  logs: SessionLog[];

  // 输出
  output?: string;
  errorReason?: string;
}

// ---- Session 管理器 ----

class SessionManager {
  private sessions = new Map<string, Session>();
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.load();
  }

  create(taskDescription: string): Session {
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: Session = {
      id,
      taskDescription,
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalSteps: 0,
      completedSteps: 0,
      keyDecisions: [],
      logs: [],
    };
    this.sessions.set(id, session);
    this.persist();
    this.log(id, "info", `Session created: ${taskDescription.slice(0, 60)}`);
    return session;
  }

  start(id: string): void {
    this.update(id, { status: "running" });
    this.log(id, "info", "Session started");
  }

  pause(id: string): void {
    this.update(id, { status: "paused" });
    this.log(id, "info", "Session paused");
  }

  complete(id: string, output: string): void {
    this.update(id, { status: "completed", output, completedAt: new Date().toISOString() });
    this.log(id, "info", `Session completed: ${output.slice(0, 80)}`);
  }

  fail(id: string, reason: string): void {
    this.update(id, { status: "failed", errorReason: reason });
    this.log(id, "error", `Session failed: ${reason}`);
  }

  recordDecision(id: string, step: string, decision: string, reason: string): void {
    const session = this.get(id);
    session.keyDecisions.push({ step, decision, reason });
    this.update(id, { keyDecisions: session.keyDecisions });
    this.log(id, "info", `Decision at [${step}]: ${decision}`);
  }

  incrementStep(id: string): void {
    const session = this.get(id);
    this.update(id, { completedSteps: session.completedSteps + 1 });
  }

  // 生成跨 session 传递的上下文摘要
  getHandoffContext(id: string): string {
    const session = this.get(id);
    const decisions = session.keyDecisions
      .map((d) => `- [${d.step}] ${d.decision} (reason: ${d.reason})`)
      .join("\n");

    return `Previous session (${id}):
Task: ${session.taskDescription}
Status: ${session.status}
Progress: ${session.completedSteps}/${session.totalSteps} steps
Key decisions:
${decisions || "  (none recorded)"}`;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    return s;
  }

  listByStatus(status: SessionStatus): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === status);
  }

  private log(id: string, level: SessionLog["level"], message: string, data?: unknown) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.logs.push({ timestamp: new Date().toISOString(), level, message, data });
    this.persist();
    const icon = level === "error" ? "❌" : level === "warn" ? "⚠️ " : "ℹ️ ";
    console.log(`  ${icon} [${id.slice(-6)}] ${message}`);
  }

  private update(id: string, updates: Partial<Session>) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    Object.assign(session, { ...updates, updatedAt: new Date().toISOString() });
    this.persist();
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(
      this.storePath,
      JSON.stringify(Array.from(this.sessions.values()), null, 2)
    );
  }

  private load() {
    if (fs.existsSync(this.storePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8")) as Session[];
        data.forEach((s) => this.sessions.set(s.id, s));
      } catch {}
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Session Manager Demo ===\n");

  const storePath = path.join(__dirname, "../../.tmp/sessions.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);

  const mgr = new SessionManager(storePath);

  // Session 1: 正常完成
  console.log("--- Session 1: normal completion ---");
  const s1 = mgr.create("Implement JWT authentication");
  mgr.start(s1.id);
  await sleep(50);
  mgr.recordDecision(s1.id, "design", "Use RS256 algorithm", "More secure than HS256 for distributed systems");
  mgr.incrementStep(s1.id);
  mgr.recordDecision(s1.id, "impl", "Token expiry: 24h", "Balance between security and UX");
  mgr.incrementStep(s1.id);
  mgr.complete(s1.id, "JWT middleware implemented with RS256, 24h expiry");

  // Session 2: 中途暂停，稍后恢复
  console.log("\n--- Session 2: paused and resumed ---");
  const s2 = mgr.create("Add refresh token support");
  mgr.start(s2.id);
  await sleep(30);
  mgr.pause(s2.id);
  console.log("  (session paused, simulating restart)");

  // 获取 handoff context（用于新 session 恢复时注入）
  const handoff = mgr.getHandoffContext(s2.id);
  console.log("\n  Handoff context for next session:");
  console.log("  " + handoff.replace(/\n/g, "\n  "));

  // Session 3: 使用上一个 session 的 handoff context
  console.log("\n--- Session 3: using handoff from session 1 ---");
  const s1Handoff = mgr.getHandoffContext(s1.id);
  const s3 = mgr.create(`Continue work. Context: ${s1Handoff}`);
  mgr.start(s3.id);
  mgr.recordDecision(s3.id, "design", "Refresh token expiry: 7d", "Based on previous session's 24h access token decision");
  mgr.complete(s3.id, "Refresh token support added");

  // 统计
  console.log("\n--- Summary ---");
  console.log(`Completed sessions: ${mgr.listByStatus("completed").length}`);
  console.log(`Paused sessions: ${mgr.listByStatus("paused").length}`);

  // 清理
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
}

main().catch(console.error);
