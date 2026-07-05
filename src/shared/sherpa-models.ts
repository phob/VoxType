export type SherpaModelStatus = "not-downloaded" | "downloaded";

export interface SherpaModelFiles {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
  bpeVocab?: string;
}

export interface SherpaModelCatalogItem {
  id: string;
  name: string;
  archiveUrl: string;
  archiveName: string;
  bundleDirName: string;
  files: SherpaModelFiles;
  modelType: "nemo_transducer";
  sizeLabel: string;
  language: string;
  description: string;
  // Optional URL to a pre-generated `bpe.vocab` for decode-time hotword biasing.
  // NVIDIA's published bundle does NOT ship it, and it cannot be derived from
  // tokens.txt (needs SentencePiece scores). Generated offline with
  // scripts/generate-parakeet-bpe-vocab.py and hosted as a static release asset;
  // SherpaModelService.downloadBpeVocab fetches it into the bundle on download,
  // which flips `hotwordsAvailable` to true. Omit to keep hotwords disabled.
  bpeVocabUrl?: string;
}

export type SherpaModel = SherpaModelCatalogItem & {
  status: SherpaModelStatus;
  bundlePath: string;
  // True only when a bpe.vocab is present on disk in the downloaded bundle,
  // which decode-time hotword biasing requires. sherpa-onnx supports NeMo TDT
  // hotwords as of PR #3077 (in the pinned v1.13.3), but NVIDIA's published
  // bundle does not ship bpe.vocab, so this is false unless one is fetched via
  // `bpeVocabUrl` (Phase 1 plan Step 0.3).
  hotwordsAvailable: boolean;
};

// NVIDIA Parakeet TDT 0.6B v3 (INT8) — pre-converted NeMo transducer bundle.
// Verified 2026-07-05 against the sherpa-onnx `asr-models` release:
// asset `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2` (~487 MB compressed,
// ~640 MB extracted). `bpe.vocab` is NOT part of the published bundle listing;
// `SherpaModelService.resolveBundlePaths` detects it at runtime and only reports
// it when present (see Phase 1 plan Step 0.3).
export const sherpaModelCatalog: SherpaModelCatalogItem[] = [
  {
    id: "parakeet-tdt-0.6b-v3-int8",
    name: "Parakeet TDT 0.6B v3 (INT8)",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    archiveName: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    bundleDirName: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    files: {
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      joiner: "joiner.int8.onnx",
      tokens: "tokens.txt",
      bpeVocab: "bpe.vocab"
    },
    modelType: "nemo_transducer",
    sizeLabel: "~640 MB",
    language: "25 European languages",
    description:
      "NVIDIA Parakeet TDT v3 (INT8). Accurate, fast, and does not hallucinate on silence.",
    // Pre-generated SentencePiece vocab (piece\tscore) enabling decode-time
    // hotword biasing. Extracted from the model's .nemo tokenizer (NVIDIA's
    // published bundle omits it) via scripts/generate-parakeet-bpe-vocab.py and
    // hosted as a static asset on the `sherpa-assets` release. Fetched into the
    // bundle by SherpaModelService.downloadBpeVocab, which flips
    // hotwordsAvailable to true. Verified end-to-end on sherpa-onnx v1.13.3.
    bpeVocabUrl:
      "https://github.com/phob/VoxType/releases/download/sherpa-assets/parakeet-tdt-0.6b-v3-int8.bpe.vocab"
  }
];

export function getSherpaModelById(id: string): SherpaModelCatalogItem | undefined {
  return sherpaModelCatalog.find((model) => model.id === id);
}
