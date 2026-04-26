export type TranscriptEntry = {
  id: string;
  text: string;
  rawText?: string;
  correctionsApplied?: string[];
  ocrCorrectionsApplied?: string[];
  promptContext?: string;
  audioFileName?: string;
  modelId: string;
  createdAt: string;
  durationMs: number;
};

export type TranscriptionResult = {
  entry: TranscriptEntry;
  promptContext: string | null;
};
