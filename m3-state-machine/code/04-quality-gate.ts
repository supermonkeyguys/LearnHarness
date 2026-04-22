/**
 * M3 - 质量门控（Quality Gates）
 *
 * 核心概念：
 * - 阶段转换的客观通过/失败标准
 * - 确定性验证：运行命令，检查退出码
 * - 门控失败时的策略：重试 / 降级 / 人工介入
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---- 质量门控定义 ----

interface GateResult {
  gateName: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

type GateCheck = () => GateResult;

// ---- 内置门控检查 ----

function makeCommandGate(name: string, command: string, cwd?: string): GateCheck {
  return (): GateResult => {
    const start = Date.now();
    try {
      const output = execSync(command, {
        cwd: cwd ?? process.cwd(),
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { gateName: name, passed: true, output: output.slice(0, 500), durationMs: Date.now() - start };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, 500);
      return { gateName: name, passed: false, output, durationMs: Date.now() - start };
    }
  };
}

// 文件存在性检查
function makeFileExistsGate(name: string, filePaths: string[]): GateCheck {
  return (): GateResult => {
    const start = Date.now();
    const missing = filePaths.filter((p) => !fs.existsSync(p));
    return {
      gateName: name,
      passed: missing.length === 0,
      output: missing.length === 0 ? "All files present" : `Missing: ${missing.join(", ")}`,
      durationMs: Date.now() - start,
    };
  };
}

// 文件内容检查（不含禁用模式）
function makeContentGate(name: string, filePath: string, forbiddenPatterns: RegExp[]): GateCheck {
  return (): GateResult => {
    const start = Date.now();
    if (!fs.existsSync(filePath)) {
      return { gateName: name, passed: false, output: `File not found: ${filePath}`, durationMs: Date.now() - start };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const violations = forbiddenPatterns.filter((p) => p.test(content));
    return {
      gateName: name,
      passed: violations.length === 0,
      output: violations.length === 0 ? "No violations" : `Violations: ${violations.map(String).join(", ")}`,
      durationMs: Date.now() - start,
    };
  };
}

// ---- 质量门控运行器 ----

type OnFailStrategy = "abort" | "retry" | "warn_continue";

interface Gate {
  check: GateCheck;
  onFail: OnFailStrategy;
  required: boolean; // false = 失败只警告，不阻止
}

class QualityGateRunner {
  private gates: Gate[] = [];

  add(check: GateCheck, options: Partial<Omit<Gate, "check">> = {}): this {
    this.gates.push({
      check,
      onFail: options.onFail ?? "abort",
      required: options.required ?? true,
    });
    return this;
  }

  async run(): Promise<{ passed: boolean; results: GateResult[] }> {
    const results: GateResult[] = [];
    let overallPassed = true;

    for (const gate of this.gates) {
      const result = gate.check();
      results.push(result);

      const icon = result.passed ? "✅" : (gate.required ? "❌" : "⚠️ ");
      console.log(`  ${icon} [${result.gateName}] ${result.passed ? "PASSED" : "FAILED"} (${result.durationMs}ms)`);
      if (!result.passed) {
        console.log(`       ${result.output.split("\n")[0]}`);
      }

      if (!result.passed && gate.required) {
        overallPassed = false;
        if (gate.onFail === "abort") break; // 中止后续检查
      }
    }

    return { passed: overallPassed, results };
  }
}

// ---- 演示 ----

async function main() {
  console.log("=== Quality Gate Demo ===\n");

  const projectRoot = path.join(__dirname, "../..");

  // 构建一套 harness 的标准质量门控
  const runner = new QualityGateRunner()
    // Gate 1: 关键文件必须存在
    .add(makeFileExistsGate("required-files", [
      path.join(projectRoot, "package.json"),
      path.join(projectRoot, "tsconfig.json"),
      path.join(projectRoot, "README.md"),
    ]))

    // Gate 2: TypeScript 编译（最重要的门控）
    .add(makeCommandGate(
      "typescript-compile",
      "npx tsc --noEmit --skipLibCheck",
      projectRoot
    ), { onFail: "abort" })

    // Gate 3: 不含 console.error 调用（可选，失败只警告）
    .add(makeContentGate(
      "no-console-error",
      path.join(projectRoot, "m1-llm-agent-basics/code/01-tool-use-basic.ts"),
      [/console\.error/]
    ), { required: false, onFail: "warn_continue" })

    // Gate 4: package.json 格式正确
    .add(makeCommandGate(
      "package-json-valid",
      "node -e \"JSON.parse(require('fs').readFileSync('package.json','utf8'))\"",
      projectRoot
    ));

  console.log("Running quality gates:\n");
  const { passed, results } = await runner.run();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Overall: ${passed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`Gates: ${results.filter((r) => r.passed).length}/${results.length} passed`);

  console.log("\n--- 关键观察 ---");
  console.log("1. TypeScript 编译是最强的质量门控——类型错误在运行前就能发现");
  console.log("2. onFail:'abort' 在关键门控失败时立即停止，不浪费资源跑后续检查");
  console.log("3. required:false 的门控是「建议」而非「强制」——失败只警告");
  console.log("4. 门控都是确定性的（同样输入永远同样结果），不依赖 LLM 判断");
}

main().catch(console.error);
