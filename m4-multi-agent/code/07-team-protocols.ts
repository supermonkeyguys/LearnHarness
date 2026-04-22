export {};

/**
 * M4 - Agent 团队协议
 *
 * 来源视角：learn-claude-code s09/s10/s11 (shareAI-lab)
 * 核心洞见：多 agent 需要结构化的通信协议，而不只是单向的任务分发
 *
 * 与你已有的 03-orchestrator.ts 的区别：
 * - Orchestrator 模式：单向分发（orchestrator → subagent → result）
 * - 团队协议：双向通信（request ↔ response，带 request_id 的握手）
 *
 * 解决两个真实问题：
 * 1. Graceful Shutdown：不能直接 kill 一个正在写文件的 agent
 *    → 发送 shutdown_request，等待 agent 完成当前工作后 approve
 * 2. Plan Approval：高风险操作（删除文件、重构核心模块）需要 lead 审批
 *    → agent 提交 plan_request，lead review 后 approve/reject
 *
 * 共同的 FSM：
 *   pending → approved
 *   pending → rejected
 *
 * 通信机制：JSONL 邮箱（每个 agent 一个文件，append-only）
 */

import * as fs from "fs";
import * as path from "path";

// ---- 消息协议 ----

type MessageType =
  | "task"               // 分配任务
  | "shutdown_request"   // 请求 graceful shutdown
  | "shutdown_response"  // 响应 shutdown 请求
  | "plan_request"       // 提交执行计划请求审批
  | "plan_response"      // 审批结果
  | "status_update"      // 状态更新（主动汇报）
  | "result";            // 任务完成结果

interface AgentMessage {
  id: string;           // 消息 ID
  requestId?: string;   // 关联的请求 ID（用于 response 消息）
  from: string;
  to: string;
  type: MessageType;
  content: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ---- 请求状态 FSM ----

type RequestStatus = "pending" | "approved" | "rejected";

interface PendingRequest {
  requestId: string;
  type: "shutdown" | "plan";
  from: string;
  to: string;
  content: string;
  status: RequestStatus;
  createdAt: string;
  resolvedAt?: string;
  feedback?: string;
}

// ---- JSONL 邮箱（每个 agent 一个文件）----

class AgentMailbox {
  private mailboxDir: string;

  constructor(baseDir: string) {
    this.mailboxDir = path.join(baseDir, ".agent-mailboxes");
    fs.mkdirSync(this.mailboxDir, { recursive: true });
  }

  send(message: AgentMessage): void {
    const file = path.join(this.mailboxDir, `${message.to}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(message) + "\n");
  }

  // 读取并清空邮箱
  receive(agentId: string): AgentMessage[] {
    const file = path.join(this.mailboxDir, `${agentId}.jsonl`);
    if (!fs.existsSync(file)) return [];

    const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
    fs.writeFileSync(file, ""); // 清空（已读）
    return lines.map((l) => JSON.parse(l) as AgentMessage);
  }

  cleanup(): void {
    fs.rmSync(this.mailboxDir, { recursive: true, force: true });
  }
}

// ---- 协议管理器 ----

class TeamProtocolManager {
  private pendingRequests = new Map<string, PendingRequest>();
  private msgIdCounter = 0;

  constructor(private mailbox: AgentMailbox, private agentId: string) {}

  private newId(): string {
    return `${this.agentId}_${++this.msgIdCounter}_${Date.now().toString(36)}`;
  }

  // ---- Shutdown Protocol ----

  // Lead 发起 shutdown 请求
  requestShutdown(targetAgent: string): string {
    const requestId = this.newId();
    this.pendingRequests.set(requestId, {
      requestId,
      type: "shutdown",
      from: this.agentId,
      to: targetAgent,
      content: "Please finish current work and shut down gracefully",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    this.mailbox.send({
      id: this.newId(),
      requestId,
      from: this.agentId,
      to: targetAgent,
      type: "shutdown_request",
      content: "Please finish current work and shut down gracefully",
      timestamp: new Date().toISOString(),
    });

    console.log(`  [Protocol] ${this.agentId} → ${targetAgent}: shutdown_request (reqId: ${requestId})`);
    return requestId;
  }

  // Agent 响应 shutdown 请求
  respondShutdown(requestId: string, approve: boolean, reason = ""): void {
    // 找到原始请求的发送方
    const request = this.pendingRequests.get(requestId);
    const replyTo = request?.from ?? "lead";

    this.mailbox.send({
      id: this.newId(),
      requestId,
      from: this.agentId,
      to: replyTo,
      type: "shutdown_response",
      content: approve ? "Approved: will finish current task and exit" : `Rejected: ${reason}`,
      data: { approve, reason },
      timestamp: new Date().toISOString(),
    });

    console.log(`  [Protocol] ${this.agentId} → ${replyTo}: shutdown_response (approve=${approve})`);
  }

  // ---- Plan Approval Protocol ----

  // Agent 提交执行计划请求审批
  submitPlan(reviewerAgent: string, plan: string): string {
    const requestId = this.newId();
    this.pendingRequests.set(requestId, {
      requestId,
      type: "plan",
      from: this.agentId,
      to: reviewerAgent,
      content: plan,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    this.mailbox.send({
      id: this.newId(),
      requestId,
      from: this.agentId,
      to: reviewerAgent,
      type: "plan_request",
      content: plan,
      timestamp: new Date().toISOString(),
    });

    console.log(`  [Protocol] ${this.agentId} → ${reviewerAgent}: plan_request (reqId: ${requestId})`);
    console.log(`    Plan: "${plan.slice(0, 60)}..."`);
    return requestId;
  }

  // Lead/Reviewer 审批计划
  approvePlan(requestId: string, approve: boolean, feedback = ""): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      console.log(`  [Protocol] Warning: unknown requestId ${requestId}`);
      return;
    }

    request.status = approve ? "approved" : "rejected";
    request.resolvedAt = new Date().toISOString();
    request.feedback = feedback;

    this.mailbox.send({
      id: this.newId(),
      requestId,
      from: this.agentId,
      to: request.from,
      type: "plan_response",
      content: feedback || (approve ? "Plan approved" : "Plan rejected"),
      data: { approve, feedback },
      timestamp: new Date().toISOString(),
    });

    const icon = approve ? "✅" : "❌";
    console.log(`  [Protocol] ${this.agentId} → ${request.from}: plan_response ${icon} (approve=${approve})`);
    if (feedback) console.log(`    Feedback: ${feedback}`);
  }

  // 处理收到的消息
  processInbox(): AgentMessage[] {
    const messages = this.mailbox.receive(this.agentId);
    for (const msg of messages) {
      // 更新本地请求状态
      if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
        const req = this.pendingRequests.get(msg.requestId)!;
        if (msg.type === "shutdown_response" || msg.type === "plan_response") {
          const data = msg.data as { approve?: boolean; feedback?: string } | undefined;
          req.status = data?.approve ? "approved" : "rejected";
          req.feedback = data?.feedback;
          req.resolvedAt = msg.timestamp;
        }
      }
    }
    return messages;
  }

  getRequestStatus(requestId: string): PendingRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  listPendingRequests(): PendingRequest[] {
    return [...this.pendingRequests.values()].filter((r) => r.status === "pending");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== Team Protocols Demo ===");
  console.log("(learn-claude-code s09/s10 pattern)\n");

  const tmpDir = path.join(__dirname, "../../.tmp/team-protocols");
  const mailbox = new AgentMailbox(tmpDir);

  // 创建三个 agent 的协议管理器
  const lead  = new TeamProtocolManager(mailbox, "lead");
  const alice = new TeamProtocolManager(mailbox, "alice");
  const bob   = new TeamProtocolManager(mailbox, "bob");

  // ============================================================
  // 场景 1: Graceful Shutdown Protocol
  // ============================================================
  console.log("=== Scenario 1: Graceful Shutdown ===\n");

  // Lead 请求 alice shutdown
  const shutdownReqId = lead.requestShutdown("alice");
  await sleep(50);

  // Alice 处理收到的 shutdown 请求
  const aliceMessages = alice.processInbox();
  console.log(`  Alice received ${aliceMessages.length} message(s)`);

  const shutdownReq = aliceMessages.find((m) => m.type === "shutdown_request");
  if (shutdownReq?.requestId) {
    // Alice 正在完成最后一个任务，然后 approve shutdown
    console.log("  Alice: finishing current task before shutdown...");
    await sleep(100);
    alice.respondShutdown(shutdownReq.requestId, true, "Finished writing output file");
  }

  // Lead 检查 shutdown 结果
  await sleep(50);
  lead.processInbox();
  const shutdownStatus = lead.getRequestStatus(shutdownReqId);
  console.log(`\n  Shutdown request status: ${shutdownStatus?.status}`);
  console.log(`  Alice's response: "${shutdownStatus?.feedback}"`);

  // ============================================================
  // 场景 2: Plan Approval Protocol
  // ============================================================
  console.log("\n=== Scenario 2: Plan Approval ===\n");

  // Bob 提交一个高风险计划
  const riskyPlan = `
    1. Delete all files in src/legacy/
    2. Rewrite auth module from scratch
    3. Update 47 import references
    This is a major refactor touching core functionality.
  `.trim();

  const planReqId = bob.submitPlan("lead", riskyPlan);
  await sleep(50);

  // Lead 审查计划
  const leadMessages = lead.processInbox();
  const planReq = leadMessages.find((m) => m.type === "plan_request");

  if (planReq?.requestId) {
    console.log(`\n  Lead reviewing plan from bob:`);
    console.log(`  "${planReq.content.slice(0, 100)}..."`);

    // Lead 拒绝计划，要求修改
    lead.approvePlan(
      planReq.requestId,
      false,
      "Too risky to delete legacy files. Keep them, just add deprecation notices."
    );
  }

  // Bob 检查审批结果
  await sleep(50);
  bob.processInbox();
  const planStatus = bob.getRequestStatus(planReqId);
  console.log(`\n  Plan request status: ${planStatus?.status}`);
  console.log(`  Lead's feedback: "${planStatus?.feedback}"`);

  // Bob 修改计划后重新提交
  const revisedPlan = "Add deprecation notices to legacy files instead of deleting them";
  const planReqId2 = bob.submitPlan("lead", revisedPlan);
  await sleep(50);

  const leadMessages2 = lead.processInbox();
  const planReq2 = leadMessages2.find((m) => m.type === "plan_request");
  if (planReq2?.requestId) {
    lead.approvePlan(planReq2.requestId, true, "Good approach, proceed");
  }

  await sleep(50);
  bob.processInbox();
  const planStatus2 = bob.getRequestStatus(planReqId2);
  console.log(`\n  Revised plan status: ${planStatus2?.status}`);
  console.log(`  Lead's feedback: "${planStatus2?.feedback}"`);

  // ============================================================
  // 对比总结
  // ============================================================
  console.log("\n=== Comparison: Orchestrator vs Team Protocols ===\n");
  console.log("  Orchestrator (M4/03-orchestrator.ts):");
  console.log("    lead → [task] → subagent → [result] → lead");
  console.log("    单向，lead 完全控制，subagent 只执行");
  console.log("");
  console.log("  Team Protocols (this file):");
  console.log("    Shutdown: lead ←→ agent (握手确认，防止数据损坏)");
  console.log("    Plan:     agent ←→ lead (高风险操作需要审批)");
  console.log("    双向，agent 有自主性，但重要决策需要确认");
  console.log("");
  console.log("  关键机制：request_id 关联请求和响应，FSM 追踪状态");

  // 清理
  mailbox.cleanup();

  console.log("\n--- 关键观察（来自 learn-claude-code s10）---");
  console.log("1. 直接 kill 一个 agent 进程是危险的（文件写到一半）——需要 shutdown 握手");
  console.log("2. Plan approval 把「执行」和「审批」分离——高风险操作不能自动执行");
  console.log("3. request_id 是关键：response 必须引用 request 的 ID，防止混淆");
  console.log("4. 同一个 FSM（pending→approved/rejected）驱动所有协议——通用模式");
  console.log("5. JSONL 邮箱是最简单的 agent 间通信实现：append-only，无需消息队列服务");
}

main().catch(console.error);
