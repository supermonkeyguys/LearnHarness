export {};

/**
 * M6 - LLM Judge
 *
 * 核心概念：
 * - 用 LLM 评估不能用命令验证的质量（代码可读性、设计合理性）
 * - Judge prompt 需要明确的评分标准，避免主观性
 * - LLM judge 有偏见，需要对抗性设计
 */

// ---- 评分结构 ----

interface JudgeScore {
  dimension: string;
  score: number;      // 1-5
  reason: string;
  issues: string[];
}

interface JudgeVerdict {
  passed: boolean;
  overallScore: number; // 1-5
  dimensions: JudgeScore[];
  summary: string;
  criticalIssues: string[];
}

// ---- Mock Judge LLM ----

class MockJudgeLLM {
  async evaluate(code: string, requirements: string): Promise<string> {
    await sleep(80);

    // 模拟基于代码内容的评分逻辑
    const hasTypes = code.includes(": string") || code.includes(": number") || code.includes("interface");
    const hasErrorHandling = code.includes("try") || code.includes("catch") || code.includes("throw");
    const hasComments = code.includes("//") || code.includes("/*");
    const hasAny = code.includes(": any");
    const hasTodo = code.includes("TODO") || code.includes("throw new Error(\"Not implemented\")");

    const correctnessScore = hasTodo ? 2 : 4;
    const qualityScore = hasTypes && !hasAny ? 4 : hasAny ? 2 : 3;
    const safetyScore = hasErrorHandling ? 4 : 2;
    const readabilityScore = hasComments ? 4 : 3;

    return JSON.stringify({
      passed: correctnessScore >= 3 && qualityScore >= 3,
      overallScore: Math.round((correctnessScore + qualityScore + safetyScore + readabilityScore) / 4),
      dimensions: [
        {
          dimension: "correctness",
          score: correctnessScore,
          reason: hasTodo ? "Contains unimplemented placeholders" : "Implementation looks complete",
          issues: hasTodo ? ["Function throws 'Not implemented' error"] : [],
        },
        {
          dimension: "type_safety",
          score: qualityScore,
          reason: hasAny ? "Uses 'any' type which bypasses type checking" : hasTypes ? "Good type annotations" : "Missing type annotations",
          issues: hasAny ? ["Found 'any' type — use specific types instead"] : [],
        },
        {
          dimension: "error_handling",
          score: safetyScore,
          reason: hasErrorHandling ? "Has error handling" : "No error handling for edge cases",
          issues: hasErrorHandling ? [] : ["No try/catch or input validation"],
        },
        {
          dimension: "readability",
          score: readabilityScore,
          reason: hasComments ? "Has comments" : "Missing comments for complex logic",
          issues: [],
        },
      ],
      summary: `Code scores ${Math.round((correctnessScore + qualityScore + safetyScore + readabilityScore) / 4)}/5 overall.`,
      criticalIssues: [
        ...(hasTodo ? ["Unimplemented functions present"] : []),
        ...(hasAny ? ["'any' type usage detected"] : []),
      ],
    } satisfies JudgeVerdict);
  }
}

// ---- Judge 运行器 ----

class LLMJudge {
  private passThreshold: number;

  constructor(private llm: MockJudgeLLM, passThreshold = 3) {
    this.passThreshold = passThreshold;
  }

  async judge(code: string, requirements: string): Promise<JudgeVerdict> {
    const raw = await this.llm.evaluate(code, requirements);

    try {
      return JSON.parse(raw) as JudgeVerdict;
    } catch {
      // Fallback: 解析失败时返回失败判定
      return {
        passed: false,
        overallScore: 1,
        dimensions: [],
        summary: "Judge failed to produce valid output",
        criticalIssues: ["Judge output parsing failed"],
      };
    }
  }

  printVerdict(verdict: JudgeVerdict): void {
    const icon = verdict.passed ? "✅" : "❌";
    console.log(`\n  ${icon} Overall: ${verdict.overallScore}/5 — ${verdict.passed ? "PASSED" : "FAILED"}`);
    console.log(`  Summary: ${verdict.summary}`);

    console.log("\n  Dimensions:");
    verdict.dimensions.forEach((d) => {
      const bar = "█".repeat(d.score) + "░".repeat(5 - d.score);
      console.log(`    ${d.dimension.padEnd(16)} [${bar}] ${d.score}/5 — ${d.reason}`);
      d.issues.forEach((i) => console.log(`      ⚠️  ${i}`));
    });

    if (verdict.criticalIssues.length > 0) {
      console.log("\n  Critical issues:");
      verdict.criticalIssues.forEach((i) => console.log(`    🚨 ${i}`));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 演示 ----

async function main() {
  console.log("=== LLM Judge Demo ===\n");

  const judge = new LLMJudge(new MockJudgeLLM(), 3);
  const requirements = "Implement a user login function with JWT token generation";

  // 代码样本 1：差的实现
  const badCode = `
export function login(user: any, pass: any): any {
  // TODO: implement login
  throw new Error("Not implemented");
}`;

  // 代码样本 2：好的实现
  const goodCode = `
interface LoginResult { token: string; expiresAt: Date }

/**
 * Authenticate user and return JWT token.
 * @throws {AuthError} if credentials are invalid
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const user = await db.findByEmail(email);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      throw new AuthError("Invalid credentials");
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: "24h" });
    return { token, expiresAt: new Date(Date.now() + 86400_000) };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new Error(\`Login failed: \${(e as Error).message}\`);
  }
}`;

  console.log("--- Judging: bad implementation ---");
  const badVerdict = await judge.judge(badCode, requirements);
  judge.printVerdict(badVerdict);

  console.log("\n\n--- Judging: good implementation ---");
  const goodVerdict = await judge.judge(goodCode, requirements);
  judge.printVerdict(goodVerdict);

  console.log("\n\n--- 关键观察 ---");
  console.log("1. LLM judge 评估主观质量（可读性、设计），确定性验证评估客观正确性");
  console.log("2. 多维度评分比单一分数更有信息量");
  console.log("3. criticalIssues 是硬性失败条件，无论总分多高都不通过");
  console.log("4. 实际场景中 judge LLM 应该和生成 LLM 不同，避免自我评分偏见");
}

main().catch(console.error);
