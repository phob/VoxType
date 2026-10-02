// Prints the failing fixtures of a cleanup report with ASR text, output and rejection details, for
// reviewing a run without opening the whole report.
// Usage: bun scripts/e2e-cleanup/failures.ts <label> [--model <name>]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argValue, e2eOutDir } from "../e2e-dictation/pipeline";

interface Run {
  model: string;
  text: string;
  failures: string[];
  knownIssue?: string;
  cleanup: { status: string; reason?: string; rejectedText?: string; durationMs: number } | null;
}

interface Result {
  id: string;
  expected: string;
  asrText: string;
  runs: Run[];
}

const label = process.argv[2];
if (!label) {
  throw new Error("Usage: bun scripts/e2e-cleanup/failures.ts <label> [--model <name>]");
}
const model = argValue("--model");
const report = JSON.parse(readFileSync(join(e2eOutDir, `cleanup-${label}.json`), "utf8")) as { results: Result[] };
const show = (text: string) => text.replace(/\n/g, "⏎");

for (const result of report.results) {
  for (const run of result.runs.filter((item) => item.failures.length > 0 && !item.knownIssue && (!model || item.model === model))) {
    console.log(`${run.model} ${result.id}: ${run.failures.join("; ")}`);
    console.log(`  asr:      ${show(result.asrText)}`);
    console.log(`  output:   ${show(run.text)} [${run.cleanup?.status ?? "-"}${run.cleanup?.reason ? `: ${run.cleanup.reason}` : ""}]`);
    if (run.cleanup?.rejectedText) {
      console.log(`  rejected: ${show(run.cleanup.rejectedText)}`);
    }
    console.log(`  expected: ${show(result.expected)}`);
  }
}
