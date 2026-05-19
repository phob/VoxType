import { type TranscriptTurn } from "./asr";

export type RealtimeTranscriptEvent = {
  providerItemId: string;
  text: string;
  final: boolean;
};

export class TranscriptTurnAccumulator {
  private readonly turns = new Map<string, TranscriptTurn>();
  private nextSequence = 1;

  apply(event: RealtimeTranscriptEvent): TranscriptTurn[] {
    const existing = this.turns.get(event.providerItemId);
    const turn: TranscriptTurn = existing ?? {
      providerItemId: event.providerItemId,
      status: "provisional",
      firstSeenSequence: this.nextSequence++
    };

    if (event.final) {
      turn.finalText = event.text;
      turn.status = "final";
    } else {
      turn.provisionalText = event.text;
      turn.status = "provisional";
    }

    this.turns.set(event.providerItemId, turn);
    return this.list();
  }

  markFallback(providerItemId: string): TranscriptTurn[] {
    const turn = this.turns.get(providerItemId);

    if (turn && !turn.finalText && turn.provisionalText) {
      turn.finalText = turn.provisionalText;
      turn.status = "fallback";
    }

    return this.list();
  }

  list(): TranscriptTurn[] {
    return [...this.turns.values()].sort(
      (first, second) => first.firstSeenSequence - second.firstSeenSequence
    );
  }

  composeFinalText(separator = " "): string {
    return this.list()
      .map((turn) => turn.finalText?.trim() ?? "")
      .filter(Boolean)
      .reduce((text, next) => joinTranscriptTurns(text, next, separator), "")
      .trim();
  }
}

function joinTranscriptTurns(existing: string, next: string, separator: string): string {
  if (!existing) {
    return next;
  }

  if (/[\n\r]$/.test(existing) || /^[\n\r\-*\d]+[.)]?\s/.test(next)) {
    return `${existing}\n${next}`;
  }

  return `${existing}${separator}${next}`;
}
