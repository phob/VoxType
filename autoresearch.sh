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
