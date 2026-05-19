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
grep_score 6 grep -R "forceModeId" -n src >/dev/null
grep_score 6 grep -R "forceModeId: \"local.custom\"" -n src/renderer >/dev/null
grep_score 6 grep -R "context\?\.forceModeId === \"local.custom\"" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "Realtime Cloud Dictation uses streaming capture" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "Realtime Cloud Dictation uses streaming capture" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "activeProviderLabel" -n src/renderer >/dev/null
grep_score 6 grep -R "getDictationMode(state.settings" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud Dictation.*activeDictationMode.label" -n src/renderer >/dev/null
grep_score 6 grep -R "activeModeIsCloud" -n src/renderer >/dev/null
grep_score 6 grep -R "cloudSetupReady" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud setup" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud mode uses OpenAI instead of a local Whisper model" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud mode does not require a local whisper.cpp runtime" -n src/renderer >/dev/null
grep_score 6 grep -R "looksLikeWhisperPromptOverride" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "whisper prompt override" -ni src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "style:" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "format as" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "previewPromptPack: (context" -n src/preload >/dev/null
grep_score 6 grep -R "transcription:preview-prompt-pack" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "includeOcrContext: settings.cloudPromptPackOcrEnabled" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "ocrContext: state.settings\?\.cloudPromptPackOcrEnabled" -n src/renderer >/dev/null
grep_score 6 grep -R "openai.com/api/pricing" -n src/renderer >/dev/null
grep_score 6 grep -R "openai.com/policies/privacy-policy" -n src/renderer >/dev/null
grep_score 6 grep -R "platform.openai.com/docs/models" -n src/renderer >/dev/null
grep_score 6 grep -R "inline-doc-links" -n src/renderer >/dev/null
grep_score 6 grep -R "openAiApiKeyDraft" -n src/renderer >/dev/null
grep_score 6 grep -R "type=\"password\"" -n src/renderer >/dev/null
grep_score 6 grep -R "setOpenAiApiKeyDraft(\"\")" -n src/renderer >/dev/null
grep_score 6 grep -R "setting-actions-with-input" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud session warning" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud session maximum" -n src/renderer >/dev/null
grep_score 6 grep -R "cloudSessionWarnMs: Number(event.target.value) \* 60000" -n src/renderer >/dev/null
grep_score 6 grep -R "cloudSessionMaxMs: Number(event.target.value) \* 60000" -n src/renderer >/dev/null
grep_score 6 grep -R "cloudSessionMaxMs: number | null" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "input.cloudSessionMaxMs === null" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "const unlimited = input.settings.cloudSessionMaxMs === null" -n src/shared/cloud-session-limits.ts >/dev/null
grep_score 6 grep -R "leave blank for unlimited" -n src/renderer >/dev/null
grep_score 6 grep -R "elapsedMs\?: number" -n src/shared/windows-helper.ts >/dev/null
grep_score 6 grep -R "formatElapsedCloudSession" -n src/renderer >/dev/null
grep_score 6 grep -R "Cloud Dictation 0:00" -n src/renderer >/dev/null
grep_score 6 grep -R "elapsedMs: limit.elapsedMs" -n src/renderer >/dev/null
grep_score 6 grep -R "createRealtimeCloudHistoryEntry" -n src/shared/realtime-history.ts >/dev/null
grep_score 6 grep -R "Realtime cloud audio playback is not saved" -n src/shared/realtime-history.ts >/dev/null
grep_score 6 grep -R "turnCount: input.turns.length" -n src/shared/realtime-history.ts >/dev/null
grep_score 6 grep -R "partial fallback used" -n src/shared/realtime-history.ts >/dev/null
grep_score 6 grep -R "composeRealtimeTurns" -n src/shared/realtime-history.ts >/dev/null
grep_score 6 grep -R "createCorrectedRealtimeCloudHistoryEntry" -n src >/dev/null
grep_score 6 grep -R "RealtimeCloudHistoryService" -n src/main >/dev/null
grep_score 6 grep -R "dictionaryStore.applyCorrections" -n src/main/realtime-cloud-history-service.ts >/dev/null
grep_score 6 grep -R "historyStore.add(entry)" -n src/main/realtime-cloud-history-service.ts >/dev/null
grep_score 6 grep -R "sanitizeRealtimeVadThresholdOverride" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "input.developerModeEnabled === true" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "realtimeVadThresholdOverride:.*null" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "RealtimeCloudSession" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "livePreviewTurns: turns" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "openAiRealtimeAudioConfig" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "appendPcm16Audio" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "developerVadThresholdOverride: this.settings.realtimeVadThresholdOverride" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "consentAccepted: boolean" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "requires Cloud Dictation consent" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "consentAccepted: settings.cloudDictationConsentAccepted" -n src/main src/main/index.ts >/dev/null
grep_score 6 grep -R "sanitizeCloudSessionMaxMs" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "Math.max(60_000, warnMs)" -n src/shared/settings.ts >/dev/null
grep_score 6 grep -R "normalizedCloudSessionMaxMinutes" -n src/renderer >/dev/null
grep_score 6 grep -R "classifyOpenAiError" -n src >/dev/null
grep_score 6 grep -R "invalid_key" -n src/shared/openai-errors.ts >/dev/null
grep_score 6 grep -R "rate_limit" -n src/shared/openai-errors.ts >/dev/null
grep_score 6 grep -R "model_access" -n src/shared/openai-errors.ts >/dev/null
grep_score 6 grep -R "Technical details" -n src/shared/openai-errors.ts >/dev/null
grep_score 6 grep -R "getCloudFailurePolicy" -n src/shared/cloud-failure-policy.ts >/dev/null
grep_score 6 grep -R "allowAutomaticLocalFallback: false" -n src/shared/cloud-failure-policy.ts >/dev/null
grep_score 6 grep -R "will not automatically retry with local dictation" -n src/shared/cloud-failure-policy.ts >/dev/null
grep_score 6 grep -R "settings-panel release-scroll-panel" -n src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "release-scroll-panel .settings-list" -n src/renderer/src/styles.css >/dev/null
grep_score 6 grep -R "getCloudFailurePolicy" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "policy.userMessage" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "formatErrorMessage" -n src/main/transcription-service.ts >/dev/null
grep_score 6 grep -R "isDictationModeId" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "entry.providerId === \"local-whisper\"" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "entry.providerId === \"openai\"" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "typeof entry.turnCount === \"number\"" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "typeof entry.turnStatus === \"string\"" -n src/main/history-store.ts >/dev/null
grep_score 6 grep -R "entry.providerId === \"openai\" \? \"Cloud Dictation\" : \"Local dictation\"" -n src/renderer >/dev/null
grep_score 6 grep -R "recent-history-row" -n src/renderer >/dev/null
grep_score 6 grep -R "getProviderLanguageHint" -n src >/dev/null
grep_score 6 grep -R "openAiSupportedLanguageHints" -n src/shared/provider-language.ts >/dev/null
grep_score 6 grep -R "languageHint.parameterValue" -n src/main/openai-asr-provider.ts >/dev/null
grep_score 6 grep -R "getProviderLanguageHint(\"openai\", language)" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "language: languageHint.parameterValue" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "OPENAI_REALTIME_WHISPER_MODEL_ID = \"gpt-realtime-whisper\"" -n src/shared/openai-models.ts >/dev/null
grep_score 6 grep -R "OPENAI_REALTIME_WHISPER_MODEL_ID" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "openAiModeModelIds" -n src/shared/openai-models.ts >/dev/null
grep_score 6 grep -R "getOpenAiModelIdForMode" -n src/main/index.ts src/shared/openai-models.ts >/dev/null
grep_score 6 grep -R "OPENAI_TRANSCRIBE_MODEL_ID" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "allOpenAiModesReadyForRelease" -n src/shared/dictation-mode-availability.ts src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "Cloud Dictation is available after all OpenAI modes are ready" -n src/shared/dictation-mode-availability.ts >/dev/null
grep_score 6 grep -R "developerCloudModePreviewEnabled" -n src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "realtimeStreamingReady: developerCloudModePreviewEnabled" -n src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "mode: 0o600" -n src/main/openai-credential-store.ts >/dev/null
grep_score 6 grep -R "chmod(this.credentialPath, 0o600)" -n src/main/openai-credential-store.ts >/dev/null
grep_score 6 grep -R "OpenAI test connection is disabled while Offline Mode is on" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "state.settings.offlineMode} onClick={() => void testOpenAiConnection" -n src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "formatRealtimeOpenAiError" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "payload.type === \"error\"" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "classifyOpenAiError" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "RealtimeErrorCallback" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "this.onError?.(new Error(formatRealtimeOpenAiError" -n src/main/openai-realtime-asr-provider.ts >/dev/null
grep_score 6 grep -R "message: error.message" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "private finalized = false" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "cancel(reason = \"Realtime Cloud Dictation session cancelled\")" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "cancelForOfflineMode" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "termLimit: 50" -n src/shared/asr.ts >/dev/null
grep_score 6 grep -R "characterLimit: 1000" -n src/shared/asr.ts >/dev/null
grep_score 6 grep -R "termLimit: PROMPT_PACK_MAX_TERMS" -n src/main/prompt-pack.ts >/dev/null
grep_score 6 grep -R "promptPack.termLimit" -n src/renderer/src/App.tsx >/dev/null
grep_score 6 grep -R "Realtime Cloud Dictation stopped because Offline Mode was enabled" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "private snapshot()" -n src/main/realtime-cloud-session.ts >/dev/null
grep_score 6 grep -R "cloudProviderLabel: undefined" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "elapsedMs: undefined" -n src/main/index.ts >/dev/null
grep_score 6 grep -R "livePreviewTurns: undefined" -n src/main/index.ts >/dev/null

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
