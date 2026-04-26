export type WhisperRuntime = {
  id: string;
  name: string;
  version: string;
  backend: string;
  platform: string;
  archiveName: string;
  url: string;
  status: "not-installed" | "installed";
  executablePath: string | null;
};

export const whisperRuntimeCatalog = {
  id: "whisper.cpp-cpu-x64",
  name: "whisper.cpp CPU x64",
  version: "v1.8.4",
  backend: "CPU",
  platform: "Windows x64",
  archiveName: "whisper-bin-x64.zip",
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip"
} as const;
