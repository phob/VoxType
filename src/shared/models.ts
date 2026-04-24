export type LocalModelStatus = "not-downloaded" | "downloaded";

export type ModelCatalogItem = {
  id: string;
  name: string;
  fileName: string;
  url: string;
  sizeLabel: string;
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
    id: "tiny.en",
    name: "Whisper tiny.en",
    fileName: "ggml-tiny.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sizeLabel: "75 MB",
    language: "English",
    description: "Fastest starter model for testing local dictation."
  },
  {
    id: "base.en",
    name: "Whisper base.en",
    fileName: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sizeLabel: "142 MB",
    language: "English",
    description: "Better baseline accuracy while staying light."
  },
  {
    id: "small.en",
    name: "Whisper small.en",
    fileName: "ggml-small.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sizeLabel: "466 MB",
    language: "English",
    description: "Higher quality for machines that can spare more memory."
  }
];

export function getModelById(id: string): ModelCatalogItem | undefined {
  return whisperModelCatalog.find((model) => model.id === id);
}

