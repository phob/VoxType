# Add opt-in Cloud Dictation while preserving local-first defaults

VoxType remains local-first by default, but will support opt-in Cloud Dictation through an ASR Provider abstraction. When OpenAI Cloud Dictation is selected, VoxType sends audio and a Prompt Pack to OpenAI for transcription, shows persistent cloud status, and keeps target-app insertion final-only rather than live-typing partial text. App profiles can forbid Cloud Dictation, Offline Mode disables it entirely, and local dictation remains available for sensitive profiles.
