export type TranscriptEntry = {
  id: string;
  text: string;
  rawText?: string;
  correctionsApplied?: string[];
  modelId: string;
  createdAt: string;
  durationMs: number;
};

export type TranscriptionResult = {
  entry: TranscriptEntry;
};
