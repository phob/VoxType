#!/usr/bin/env bash
set -euo pipefail
start_ns=$(node -e 'process.stdout.write(String(process.hrtime.bigint()))')

typecheck_log=$(mktemp)
if npm run typecheck >"$typecheck_log" 2>&1; then
  typecheck_status=1
else
  typecheck_status=0
  tail -80 "$typecheck_log" >&2
fi
end_ns=$(node -e 'process.stdout.write(String(process.hrtime.bigint()))')
typecheck_seconds=$(node -e "console.log(((BigInt('$end_ns')-BigInt('$start_ns'))/1000000n).toString())")
typecheck_seconds=$(node -e "console.log(($typecheck_seconds/1000).toFixed(3))")
rm -f "$typecheck_log"

score=0
privacy=0
provider_files=$(find src -type f \( -name '*asr*' -o -name '*dictation*' -o -name '*openai*' -o -name '*credential*' -o -name '*prompt-pack*' \) | wc -l | tr -d ' ')

grep_score() {
  local points="$1"; shift
  if "$@"; then score=$((score + points)); fi
}
grep_privacy() {
  if "$@"; then privacy=$((privacy + 1)); fi
}

grep_score 4 grep -R "local\.balanced" -n src >/dev/null
grep_score 4 grep -R "openai\.realtime" -n src >/dev/null
grep_score 4 grep -R "openai\.accuracy" -n src >/dev/null
grep_score 4 grep -R "openai\.economy" -n src >/dev/null
grep_score 6 grep -R "DictationMode" -n src >/dev/null
grep_score 6 grep -R "FileAsrProvider" -n src >/dev/null
grep_score 6 grep -R "StreamingAsrProvider" -n src >/dev/null
grep_score 6 grep -R "AsrResult" -n src >/dev/null
grep_score 6 grep -R "cloudDictationConsent" -n src >/dev/null
grep_score 6 grep -R "offlineMode" -n src >/dev/null
grep_score 6 grep -R "forbidCloud" -n src >/dev/null
grep_score 6 grep -R "PromptPack" -n src >/dev/null
grep_score 6 grep -R "maxTerms.*50\|50.*maxTerms\|PROMPT_PACK_MAX_TERMS" -n src >/dev/null
grep_score 6 grep -R "1000\|PROMPT_PACK_MAX_CHAR" -n src >/dev/null
grep_score 6 grep -R "Credential\|keytar\|safeStorage\|OPENAI_API_KEY" -n src >/dev/null
grep_score 6 grep -R "gpt-realtime-whisper" -n src >/dev/null
grep_score 6 grep -R "gpt-4o-transcribe" -n src >/dev/null
grep_score 6 grep -R "gpt-4o-mini-transcribe" -n src >/dev/null
grep_score 4 grep -R "providerId" -n src/shared src/main >/dev/null
grep_score 4 grep -R "dictationModeId" -n src/shared src/main >/dev/null
grep_score 4 grep -R "rawText" -n src/shared src/main >/dev/null
grep_score 4 grep -R "Live Preview\|livePreview\|provisional" -n src >/dev/null
grep_score 5 grep -R "Cloud Dictation is disabled while Offline Mode" -n src >/dev/null
grep_score 5 grep -R "forbids Cloud Dictation" -n src >/dev/null
grep_score 5 grep -R "one-time consent" -n src >/dev/null
grep_score 5 grep -R "OpenAI API key" -n src >/dev/null
grep_score 5 grep -R "resolveDictationMode" -n src >/dev/null
grep_score 5 grep -R "openai-credentials:get-status\|openaiCredentials" -n src >/dev/null
grep_score 5 grep -R "setApiKey" -n src/main src/preload >/dev/null
grep_score 5 grep -R "clearApiKey" -n src/main src/preload >/dev/null
grep_score 6 grep -R "audio/transcriptions" -n src/main >/dev/null
grep_score 6 grep -R "FormData" -n src/main >/dev/null
grep_score 6 grep -R "promptPack\.text" -n src/main >/dev/null
grep_score 6 grep -R "metadata-only error" -n src/main >/dev/null
grep_score 6 grep -R "transcribeCloudFile" -n src/main >/dev/null
grep_score 6 grep -R "OpenAiFileAsrProvider" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "buildCloudPromptPack" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "hasApiKey" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "Realtime Cloud Dictation is not available yet" -n src/main >/dev/null
grep_score 6 grep -R "TranscriptTurnAccumulator" -n src >/dev/null
grep_score 6 grep -R "firstSeenSequence" -n src >/dev/null
grep_score 6 grep -R "markFallback" -n src >/dev/null
grep_score 6 grep -R "composeFinalText" -n src >/dev/null
grep_score 6 grep -R "OpenAiRealtimeAsrProvider" -n src >/dev/null
grep_score 6 grep -R "gpt-realtime-whisper" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "server_vad" -n src/main >/dev/null
grep_score 6 grep -R "pcm16" -n src/main >/dev/null
grep_score 6 grep -R "pre-connection buffer" -n src/main >/dev/null
grep_score 6 grep -R "livePreviewTurns" -n src >/dev/null
grep_score 6 grep -R "overlay-live-preview" -n src/renderer >/dev/null
grep_score 6 grep -R "finalizing" -n src/shared src/renderer >/dev/null
grep_score 6 grep -R "cloudProviderLabel" -n src >/dev/null
grep_score 6 grep -R "CloudDictationReadiness" -n src >/dev/null
grep_score 6 grep -R "transcription:get-readiness" -n src >/dev/null
grep_score 6 grep -R "getReadiness" -n src/renderer src/preload >/dev/null
grep_score 6 grep -R "!readiness\.ready" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud Dictation consent" -n src/renderer >/dev/null
grep_score 6 grep -R "Allow OCR Context in cloud Prompt Pack" -n src/renderer >/dev/null
grep_score 6 grep -R "OpenAI API key" -n src/renderer >/dev/null
grep_score 6 grep -R "dictationModes" -n src/renderer >/dev/null
grep_score 6 grep -R "profileDictationModeOptions" -n src/renderer >/dev/null
grep_score 6 grep -R "Forbid Cloud Dictation" -n src/renderer >/dev/null
grep_score 6 grep -R "dictationModeId: patch\.dictationModeId" -n src/renderer >/dev/null
grep_score 6 grep -R "forbidCloudDictation: patch\.forbidCloudDictation" -n src/renderer >/dev/null
grep_score 6 grep -R "openai:test-connection" -n src >/dev/null
grep_score 6 grep -R "testConnection" -n src/main/openai-asr-provider.ts src/preload src/renderer >/dev/null
grep_score 6 grep -R "Test connection" -n src/renderer >/dev/null
grep_score 6 grep -R "v1/models" -n src/main/openai-asr-provider.ts >/dev/null
grep_score 6 grep -R "Cloud Dictation.*entry.providerId" -n src/renderer >/dev/null
grep_score 6 grep -R "entry.dictationModeId" -n src/renderer >/dev/null
grep_score 6 grep -R "entry.turnCount" -n src/renderer >/dev/null
grep_score 6 grep -R "entry.turnStatus" -n src/renderer >/dev/null
grep_score 6 grep -R "disabled in Offline Mode" -n src/renderer >/dev/null
grep_score 6 grep -R "API key required" -n src/renderer >/dev/null
grep_score 6 grep -R "option disabled" -n src/renderer >/dev/null
grep_score 6 grep -R "API key required before recording" -n src/renderer >/dev/null
grep_score 6 grep -R "terminateActiveCloudDictationForOfflineMode" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud Dictation stopped because Offline Mode" -n src/renderer >/dev/null
grep_score 6 grep -R "isCloudDictationMode" -n src/renderer >/dev/null
grep_score 6 grep -R "Transcribing with OpenAI" -n src/renderer >/dev/null
grep_score 6 grep -R "showTranscribing: (state" -n src/preload >/dev/null
grep_score 6 grep -R "cloudProviderLabel: readiness.cloud" -n src/renderer >/dev/null
grep_score 6 grep -R "getDictationMode(mode.modeId)" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "openAiFileAsrProvider.testConnection(modelId)" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "transcription:preview-prompt-pack" -n src >/dev/null
grep_score 6 grep -R "previewPromptPack" -n src/preload src/renderer >/dev/null
grep_score 6 grep -R "Cloud Prompt Pack preview" -n src/renderer >/dev/null
grep_score 6 grep -R "includeOcrContext: false" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "forbidCloudDictation.*isCloudDictationMode" -n src/shared/cloud-status.ts src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "local\.balanced" -n src/shared/cloud-status.ts src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "dictationModeSettingsPatch" -n src/renderer >/dev/null
grep_score 6 grep -R "activeModelId: mode.modelId" -n src/renderer >/dev/null
grep_score 6 grep -R "appendPcm16Audio" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "input_audio_buffer.append" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "input_audio_buffer.commit" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "toString(\"base64\")" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "StreamingAudioConfig" -n src/shared/asr.ts >/dev/null
grep_score 6 grep -R "sampleRateHz: 24000" -n src/shared/asr.ts >/dev/null
grep_score 6 grep -R "OpenAI realtime requires 24 kHz PCM16 mono audio" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "input_audio_transcription" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "cloudSessionWarnMs" -n src >/dev/null
grep_score 6 grep -R "cloudSessionMaxMs" -n src >/dev/null
grep_score 6 grep -R "getCloudSessionLimitState" -n src >/dev/null
grep_score 6 grep -R "maximum session duration" -n src >/dev/null
grep_score 6 grep -R "startCloudSessionLimitTimer" -n src/renderer >/dev/null
grep_score 6 grep -R "clearCloudSessionLimitTimer" -n src/renderer >/dev/null
grep_score 6 grep -R "getCloudSessionLimitState" -n src/renderer >/dev/null
grep_score 6 grep -R "limit.shouldStop" -n src/renderer >/dev/null
grep_score 6 grep -R "limit.shouldWarn" -n src/renderer >/dev/null
grep_score 6 grep -R "realtimeLatencyPreset" -n src >/dev/null
grep_score 6 grep -R "getOpenAiRealtimeVadConfig" -n src >/dev/null
grep_score 6 grep -R "silence_duration_ms" -n src/shared/realtime-latency.ts >/dev/null
grep_score 6 grep -R "Realtime latency preset" -n src/renderer >/dev/null
grep_score 6 grep -R "latencyPreset" -n src/main/openai-realtime-asr-provider.ts src/shared/asr.ts >/dev/null
grep_score 6 grep -R "CloudDictationLogEntry" -n src >/dev/null
grep_score 6 grep -R "assertCloudDictationLogIsMetadataOnly" -n src >/dev/null
grep_score 6 grep -R "sensitive field" -n src/shared/cloud-logging.ts >/dev/null
grep_score 6 grep -R "status: \"completed\"" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "status: \"started\"" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "status: \"failed\"" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "cloudErrorCode" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "failedLogEntry" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "recording-overlay:show-finalizing" -n src >/dev/null
grep_score 6 grep -R "showFinalizing" -n src/preload src/renderer >/dev/null
grep_score 6 grep -R "Finalizing cloud dictation" -n src/renderer >/dev/null
grep_score 6 grep -R "mode: \"finalizing\"" -n src/main >/dev/null
grep_score 6 grep -R "exactLocalModelSettingsPatch" -n src/renderer >/dev/null
grep_score 6 grep -R "localCustomModelId: modelId" -n src/renderer >/dev/null
grep_score 6 grep -R "dictationModeId: \"local.custom\"" -n src/renderer >/dev/null
grep_score 6 grep -R "exactLocalModelSettingsPatch(event.target.value)" -n src/renderer >/dev/null
grep_score 6 grep -R "audioUnavailableReason" -n src >/dev/null
grep_score 6 grep -R "entry.audioUnavailableReason" -n src/renderer >/dev/null
grep_score 6 grep -R "typeof entry.audioUnavailableReason" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "realtimeVadThresholdOverride" -n src >/dev/null
grep_score 6 grep -R "sanitizeDeveloperVadThresholdOverride" -n src/shared/realtime-latency.ts >/dev/null
grep_score 6 grep -R "Developer realtime VAD threshold" -n src/renderer >/dev/null
grep_score 6 grep -R "developerVadThresholdOverride" -n src/main/openai-realtime-asr-provider.ts src/shared/asr.ts >/dev/null
grep_score 6 grep -R "getDictationModeAvailability" -n src >/dev/null
grep_score 6 grep -R "Realtime streaming is not available yet" -n src/shared/dictation-mode-availability.ts >/dev/null
grep_score 6 grep -R "realtimeStreamingReady: false" -n src/renderer >/dev/null
grep_score 6 grep -R "disabled={!availability.selectable}" -n src/renderer >/dev/null

grep_privacy grep -R "never.*screenshot\|Screenshots.*never\|screenshot.*never" -ni src planning/cloud-dictation-prd.md >/dev/null
grep_privacy grep -R "full Dictionary\|full dictionary" -ni src planning/cloud-dictation-prd.md >/dev/null
grep_privacy grep -R "transcript history" -ni src planning/cloud-dictation-prd.md >/dev/null
grep_privacy grep -R "whisperPromptOverride" -n src >/dev/null

score=$((score * typecheck_status))

echo "METRIC cloud_acceptance_score=$score"
echo "METRIC typecheck_seconds=$typecheck_seconds"
echo "METRIC provider_files=$provider_files"
echo "METRIC cloud_privacy_markers=$privacy"
exit $((typecheck_status == 1 ? 0 : 1))
