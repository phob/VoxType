// German TTS for E2E fixtures: Piper with the original rhasspy voices, fetched once into target/e2e.
// Piper reads UTF-8 from stdin; sherpa-onnx-offline-tts takes text as a command-line argument, which
// Windows hands over in the ANSI code page and garbles umlauts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const piperZipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
const voiceBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE";

export const piperVoices = [
  { id: "de_DE-thorsten-medium", path: "thorsten/medium" },
  { id: "de_DE-kerstin-low", path: "kerstin/low" }
];

export function renderPiper(modelsDir: string, jobs: Array<{ text: string; voice: string; path: string }>): void {
  const piper = ensurePiper(modelsDir);

  for (const voice of piperVoices) {
    const voiceJobs = jobs.filter((job) => job.voice === voice.id);
    if (voiceJobs.length === 0) {
      continue;
    }

    const model = ensureVoice(modelsDir, voice);
    const input = voiceJobs.map((job) => JSON.stringify({ text: job.text, output_file: job.path })).join("\n");
    execFileSync(piper, ["--model", model, "--json-input", "--quiet"], { input: `${input}\n`, stdio: ["pipe", "ignore", "inherit"] });

    for (const job of voiceJobs) {
      if (!existsSync(job.path)) {
        throw new Error(`Piper did not write ${job.path}`);
      }
    }
  }
}

function ensurePiper(modelsDir: string): string {
  const exe = join(modelsDir, "piper", "piper.exe");
  if (existsSync(exe)) {
    return exe;
  }

  mkdirSync(modelsDir, { recursive: true });
  const zip = join(modelsDir, "piper.zip");
  download(piperZipUrl, zip);
  // Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) does not.
  execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", modelsDir]);
  rmSync(zip, { force: true });

  if (!existsSync(exe)) {
    throw new Error(`piper.exe not found after extracting ${piperZipUrl}`);
  }
  return exe;
}

function ensureVoice(modelsDir: string, voice: { id: string; path: string }): string {
  const model = join(modelsDir, `${voice.id}.onnx`);
  if (!existsSync(model) || !existsSync(`${model}.json`)) {
    download(`${voiceBaseUrl}/${voice.path}/${voice.id}.onnx`, model);
    download(`${voiceBaseUrl}/${voice.path}/${voice.id}.onnx.json`, `${model}.json`);
  }
  return model;
}

function download(url: string, destination: string): void {
  console.log(`downloading ${url}`);
  execFileSync("curl.exe", ["-sSfL", "-o", destination, url], { stdio: "inherit" });
}
