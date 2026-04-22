/**
 * M6 - 确定性验证器
 *
 * 核心概念：
 * - 确定性验证：同样输入永远同样结果，不依赖 LLM
 * - 运行真实命令（tsc / eslint / tests）
 * - 结果可信、可重现、成本低
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---- 验证结果 ----

interface ValidationResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
  exitCode: number;
}

interface ValidationReport {
  overallPassed: boolean;
  results: ValidationResult[];
  totalDurationMs: number;
  passCount: number;
  failCount: number;
}

// ---- 命令执行器 ----

function runCommand(
  name: string,
  command: string,
  cwd: string,
  timeoutMs = 30_000
): ValidationResult {
  const start = Date.now();
  const opts: ExecSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  };

  try {
    const output = execSync(command, opts);
    return { name, passed: true, output: output.slice(0, 1000), durationMs: Date.now() - start, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").slice(0, 1000);
    return { name, passed: false, output, durationMs: Date.now() - start, exitCode: err.status ?? 1 };
  }
}

// ---- 内置验证器集合 ----

class DeterministicValidator {
  private validators: Array<() => ValidationResult> = [];

  constructor(private projectRoot: string) {}

  // TypeScript 类型检查
  addTypeCheck(): this {
    this.validators.push(() =>
      runCommand("TypeScript", "npx tsc --noEmit --skipLibCheck", this.projectRoot)
    );
    return this;
  }

  // 文件存在性检查
  addFileExists(files: string[]): this {
    this.validators.push(() => {
      const start = Date.now();
      const missing = files.filter((f) => !fs.existsSync(path.join(this.projectRoot, f)));
      return {
        name: "Required Files",
        passed: missing.length === 0,
        output: missing.length === 0 ? "All files present" : `Missing: ${missing.join(", ")}`,
        durationMs: Date.now() - start,
        exitCode: missing.length === 0 ? 0 : 1,
      };
    });
    return this;
  }

  // JSON 格式验证
  addJsonValid(filePath: string): this {
    this.validators.push(() => {
      const start = Date.now();
      const fullPath = path.join(this.projectRoot, filePath);
      try {
        JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        return { name: `JSON: ${filePath}`, passed: true, output: "Valid JSON", durationMs: Date.now() - start, exitCode: 0 };
      } catch (e) {
        return { name: `JSON: ${filePath}`, passed: false, output: (e as Error).message, durationMs: Date.now() - start, exitCode: 1 };
      }
    });
    return this;
  }

  // 自定义命令
  addCommand(name: string, command: string): this {
    this.validators.push(() => runCommand(name, command, this.projectRoot));
    return this;
  }

  // 运行所有验证
  run(): ValidationReport {
    const start = Date.now();
    const results: ValidationResult[] = [];

    for (const validator of this.validators) {
      const result = validator();
      results.push(result);

      const icon = result.passed ? "✅" : "❌";
      console.log(`  ${icon} [${result.name}] ${result.passed ? "PASSED" : "FAILED"} (${result.durationMs}ms)`);
      if (!result.passed) {
        const firstLine = result.output.split("\n")[0];
        console.log(`       ${firstLine}`);
      }

      // 关键验证失败时立即停止（快速失败）
      if (!result.passed && result.name === "TypeScript") {
        console.log("  ⛔ TypeScript check failed — stopping validation");
        break;
      }
    }

    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.filter((r) => !r.passed).length;

    return {
      overallPassed: failCount === 0,
      results,
      totalDurationMs: Date.now() - start,
      passCount,
      failCount,
    };
  }
}

// ---- 演示 ----

function main() {
  console.log("=== Deterministic Validator Demo ===\n");

  const projectRoot = path.join(__dirname, "../..");

  const validator = new DeterministicValidator(projectRoot)
    .addFileExists(["package.json", "tsconfig.json", "README.md"])
    .addJsonValid("package.json")
    .addTypeCheck();

  console.log("Running validators:\n");
  const report = validator.run();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Overall: ${report.overallPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`${report.passCount} passed, ${report.failCount} failed in ${report.totalDurationMs}ms`);

  console.log("\n--- 关键观察 ---");
  console.log("1. 确定性验证不消耗 LLM token，成本几乎为零");
  console.log("2. TypeScript 编译是最强的门控：类型错误 = 代码有问题");
  console.log("3. 快速失败：TypeScript 失败后不继续跑其他验证（节省时间）");
  console.log("4. 所有结果可重现：同样代码永远给同样结果");
}

main();
