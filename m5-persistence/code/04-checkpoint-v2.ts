/**
 * M5 - Checkpoint v2（完整版）
 *
 * 在 M3/03-checkpoint.ts 基础上增加：
 * - 版本冲突检测（防止并发写入）
 * - 自动清理过期 checkpoint
 * - checkpoint 元数据索引
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---- Checkpoint 结构（增强版）----

interface CheckpointV2 {
  taskId: string;
  version: number;
  checksum: string;       // 内容 hash，用于完整性验证
  state: string;
  completedSteps: number[];
  stepResults: Record<number, string>;
  retryCount: number;
  metadata: {
    createdAt: string;
    updatedAt: string;
    expiresAt: string;    // 过期时间
    totalTokensUsed: number;
  };
}

// ---- Checkpoint 管理器 v2 ----

class CheckpointManagerV2 {
  private dir: string;
  private indexPath: string;
  private index: Record<string, { taskId: string; version: number; updatedAt: string }> = {};

  constructor(baseDir: string, private ttlMs = 24 * 60 * 60 * 1000) { // 默认 24h 过期
    this.dir = path.join(baseDir, ".harness-checkpoints-v2");
    this.indexPath = path.join(this.dir, "_index.json");
    fs.mkdirSync(this.dir, { recursive: true });
    this.loadIndex();
    this.cleanExpired();
  }

  private checksum(data: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 8);
  }

  private filePath(taskId: string): string {
    return path.join(this.dir, `${taskId.replace(/[^a-zA-Z0-9-_]/g, "_")}.json`);
  }

  save(checkpoint: Omit<CheckpointV2, "checksum" | "metadata"> & { metadata?: Partial<CheckpointV2["metadata"]> }): void {
    const existing = this.load(checkpoint.taskId);

    // 版本冲突检测：如果磁盘上的版本比我们的新，拒绝写入
    if (existing && existing.version > checkpoint.version) {
      throw new Error(
        `Version conflict: disk has v${existing.version}, trying to write v${checkpoint.version}`
      );
    }

    const now = new Date().toISOString();
    const full: CheckpointV2 = {
      ...checkpoint,
      checksum: "",
      metadata: {
        createdAt: existing?.metadata.createdAt ?? now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
        totalTokensUsed: checkpoint.metadata?.totalTokensUsed ?? 0,
      },
    };
    full.checksum = this.checksum(full);

    // 原子写
    const file = this.filePath(checkpoint.taskId);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(full, null, 2));
    fs.renameSync(tmp, file);

    // 更新索引
    this.index[checkpoint.taskId] = { taskId: checkpoint.taskId, version: full.version, updatedAt: now };
    this.saveIndex();

    console.log(`  [CheckpointV2] Saved: ${checkpoint.taskId} v${checkpoint.version} (checksum: ${full.checksum})`);
  }

  load(taskId: string): CheckpointV2 | null {
    const file = this.filePath(taskId);
    if (!fs.existsSync(file)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as CheckpointV2;

      // 完整性验证
      const expectedChecksum = data.checksum;
      const actualChecksum = this.checksum({ ...data, checksum: "" });
      if (expectedChecksum !== actualChecksum) {
        console.warn(`  [CheckpointV2] Checksum mismatch for ${taskId} — checkpoint may be corrupt`);
        return null;
      }

      // 过期检查
      if (new Date(data.metadata.expiresAt) < new Date()) {
        console.log(`  [CheckpointV2] Checkpoint expired: ${taskId}`);
        this.clear(taskId);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  clear(taskId: string): void {
    const file = this.filePath(taskId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    delete this.index[taskId];
    this.saveIndex();
  }

  listActive(): Array<{ taskId: string; version: number; updatedAt: string }> {
    return Object.values(this.index);
  }

  private cleanExpired(): void {
    let cleaned = 0;
    for (const taskId of Object.keys(this.index)) {
      const cp = this.load(taskId); // load() 内部会检查过期并删除
      if (!cp) cleaned++;
    }
    if (cleaned > 0) console.log(`  [CheckpointV2] Cleaned ${cleaned} expired checkpoints`);
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
      } catch { this.index = {}; }
    }
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }
}

// ---- 演示 ----

async function main() {
  console.log("=== Checkpoint V2 Demo ===\n");

  const mgr = new CheckpointManagerV2(path.join(__dirname, "../.."), 5000); // 5s TTL for demo

  const taskId = "task-v2-demo";

  // 正常保存和加载
  console.log("1. Save and load:");
  mgr.save({ taskId, version: 1, state: "EXECUTING", completedSteps: [1], stepResults: { 1: "done" }, retryCount: 0 });
  mgr.save({ taskId, version: 2, state: "VERIFYING", completedSteps: [1, 2], stepResults: { 1: "done", 2: "done" }, retryCount: 0 });

  const loaded = mgr.load(taskId);
  console.log(`  Loaded: v${loaded?.version}, state=${loaded?.state}, steps=${loaded?.completedSteps}`);
  console.log(`  Checksum verified: ✅`);

  // 版本冲突检测
  console.log("\n2. Version conflict detection:");
  try {
    mgr.save({ taskId, version: 1, state: "EXECUTING", completedSteps: [1], stepResults: {}, retryCount: 0 });
  } catch (e) {
    console.log(`  ✅ Correctly rejected: ${(e as Error).message}`);
  }

  // 索引
  console.log("\n3. Active checkpoints:");
  mgr.listActive().forEach((c) => console.log(`  - ${c.taskId} v${c.version} (${c.updatedAt})`));

  // 清理
  mgr.clear(taskId);
  fs.rmSync(path.join(__dirname, "../../.harness-checkpoints-v2"), { recursive: true, force: true });
}

main().catch(console.error);
