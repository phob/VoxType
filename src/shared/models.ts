export type LocalModelStatus = "not-downloaded" | "downloaded";

export type ModelCatalogItem = {
  id: string;
  name: string;
  fileName: string;
  url: string;
  sizeLabel: string;
  minimumVramMb: number;
  language: string;
  description: string;
};

export type LocalModel = ModelCatalogItem & {
  status: LocalModelStatus;
  localPath: string;
  downloadedBytes: number;
};

export const whisperModelCatalog: ModelCatalogItem[] = [
  {
    id: "tiny",
    name: "Whisper tiny",
    fileName: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sizeLabel: "75 MB",
    minimumVramMb: 273,
    language: "Multilingual",
    description: "Fastest multilingual starter model.",
  },
  {
    id: "tiny.en",
    name: "Whisper tiny.en",
    fileName: "ggml-tiny.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sizeLabel: "75 MB",
    minimumVramMb: 273,
    language: "English",
    description: "Fastest starter model for testing local dictation.",
  },
  {
    id: "base",
    name: "Whisper base",
    fileName: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sizeLabel: "142 MB",
    minimumVramMb: 388,
    language: "Multilingual",
    description: "Light multilingual model for everyday testing.",
  },
  {
    id: "base.en",
    name: "Whisper base.en",
    fileName: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sizeLabel: "142 MB",
    minimumVramMb: 388,
    language: "English",
    description: "Better baseline accuracy while staying light.",
  },
  {
    id: "small",
    name: "Whisper small",
    fileName: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sizeLabel: "466 MB",
    minimumVramMb: 852,
    language: "Multilingual",
    description: "Good multilingual default for many Windows machines.",
  },
  {
    id: "small.en",
    name: "Whisper small.en",
    fileName: "ggml-small.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sizeLabel: "466 MB",
    minimumVramMb: 852,
    language: "English",
    description: "Higher quality for machines that can spare more memory.",
  },
  {
    id: "medium",
    name: "Whisper medium",
    fileName: "ggml-medium.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    sizeLabel: "1.5 GiB",
    minimumVramMb: 2100,
    language: "Multilingual",
    description: "Higher multilingual accuracy for capable machines.",
  },
  {
    id: "medium.en",
    name: "Whisper medium.en",
    fileName: "ggml-medium.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    sizeLabel: "1.5 GiB",
    minimumVramMb: 2100,
    language: "English",
    description: "Higher English accuracy for capable machines.",
  },
  {
    id: "large-v3-turbo",
    name: "Whisper large-v3-turbo",
    fileName: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    sizeLabel: "1.5 GiB",
    minimumVramMb: 2100,
    language: "Multilingual",
    description: "Highest quality for machines that can spare more memory.",
  },
];

export function getModelById(id: string): ModelCatalogItem | undefined {
  return whisperModelCatalog.find((model) => model.id === id);
}
