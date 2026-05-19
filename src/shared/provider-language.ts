import { type AsrProviderId } from "./asr";
import { type WhisperLanguage } from "./settings";

export type ProviderLanguageHint = {
  providerId: AsrProviderId;
  language: WhisperLanguage;
  parameterValue: string | null;
};

const openAiSupportedLanguageHints = new Set<WhisperLanguage>([
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "pl",
  "ru",
  "ja",
  "ko",
  "zh"
]);

export function getProviderLanguageHint(
  providerId: AsrProviderId,
  language: WhisperLanguage
): ProviderLanguageHint {
  if (language === "auto") {
    return { providerId, language, parameterValue: null };
  }

  if (providerId === "openai" && openAiSupportedLanguageHints.has(language)) {
    return { providerId, language, parameterValue: language };
  }

  if (providerId === "local-whisper") {
    return { providerId, language, parameterValue: language };
  }

  return { providerId, language, parameterValue: null };
}
