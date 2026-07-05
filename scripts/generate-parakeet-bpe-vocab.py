#!/usr/bin/env python3
"""Generate a ``bpe.vocab`` file for a NeMo Parakeet model.

sherpa-onnx decode-time hotword biasing (``--decoding-method=modified_beam_search
--modeling-unit=bpe --bpe-vocab=bpe.vocab``) needs the SentencePiece pieces AND
their scores. The published Parakeet bundle only ships ``tokens.txt`` (piece->id,
no scores), and sherpa-onnx deliberately does not depend on the SentencePiece C++
library, so the vocab cannot be reconstructed from ``tokens.txt`` alone — the
scores must come from the original tokenizer.

This mirrors k2-fsa/sherpa-onnx PR #3077 (``scripts/nemo/generate_bpe_vocab.py``,
merged 2026-02-05, shipped in v1.13.3) but takes the SentencePiece model directly
so it only needs the small ``sentencepiece`` package — no ``nemo_toolkit``/torch.

This is a ONE-TIME, OFFLINE step. The produced ``bpe.vocab`` is then hosted and
fetched at model-download time (see ``SherpaModelService.downloadBpeVocab`` and
``bpeVocabUrl`` in ``src/shared/sherpa-models.ts``). It is NOT run inside the app.

Usage
-----
    pip install sentencepiece

    # From a SentencePiece model you already extracted:
    python scripts/generate-parakeet-bpe-vocab.py --spm tokenizer.model --output bpe.vocab

    # From a .nemo checkpoint (a tar archive; the tokenizer .model is pulled out):
    python scripts/generate-parakeet-bpe-vocab.py --nemo parakeet-tdt-0.6b-v3.nemo --output bpe.vocab

Getting the .nemo (once):
    pip install huggingface_hub
    huggingface-cli download nvidia/parakeet-tdt-0.6b-v3 --local-dir ./parakeet-v3
    # then point --nemo at the downloaded .nemo file.

Output format: one ``piece<TAB>score`` line per SentencePiece id, in id order.
"""

from __future__ import annotations

import argparse
import sys
import tarfile
import tempfile
from pathlib import Path


def _spm_from_nemo(nemo_path: Path) -> Path:
    """Extract the SentencePiece tokenizer model from a .nemo tar archive."""
    with tarfile.open(nemo_path, "r:*") as tar:
        candidates = [m for m in tar.getmembers() if m.name.endswith(".model")]
        if not candidates:
            raise SystemExit(
                f"No '*.model' SentencePiece tokenizer found inside {nemo_path}. "
                "Is this a SentencePiece-tokenized NeMo checkpoint?"
            )
        # Prefer a member whose name mentions the tokenizer; else the largest .model.
        member = next(
            (m for m in candidates if "tokenizer" in m.name.lower()),
            max(candidates, key=lambda m: m.size),
        )
        out_dir = Path(tempfile.mkdtemp(prefix="parakeet-spm-"))
        tar.extract(member, out_dir)
        return out_dir / member.name


def _write_vocab(spm_model: Path, output: Path) -> int:
    try:
        import sentencepiece as spm  # noqa: PLC0415 (optional dependency)
    except ImportError:
        raise SystemExit(
            "The 'sentencepiece' package is required. Install it with:\n"
            "  pip install sentencepiece"
        )

    sp = spm.SentencePieceProcessor(model_file=str(spm_model))
    lines = []
    for token_id in range(sp.vocab_size()):
        piece = sp.id_to_piece(token_id)
        score = sp.get_score(token_id)
        # sherpa-onnx's ssentencepiece reader expects tab-separated piece + score.
        lines.append(f"{piece}\t{score}")

    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--spm", type=Path, help="Path to a SentencePiece .model file.")
    source.add_argument("--nemo", type=Path, help="Path to a .nemo checkpoint to extract the tokenizer from.")
    parser.add_argument("--output", type=Path, default=Path("bpe.vocab"), help="Where to write bpe.vocab.")
    args = parser.parse_args(argv)

    spm_model = args.spm if args.spm is not None else _spm_from_nemo(args.nemo)
    if not spm_model.exists():
        raise SystemExit(f"SentencePiece model not found: {spm_model}")

    count = _write_vocab(spm_model, args.output)
    print(f"Wrote {count} pieces to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
