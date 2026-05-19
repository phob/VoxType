import { type AsrProviderId } from "./asr";
import { type WhisperLanguage } from "./settings";

export type ProviderLanguageHint = {
  providerId: AsrProviderId;
  language: WhisperLanguage;
  parameterValue: string | null;
  supported: boolean;
  reason: string | null;
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
    return { providerId, language, parameterValue: null, supported: true, reason: "auto language detection" };
  }

  if (providerId === "openai" && openAiSupportedLanguageHints.has(language)) {
    return { providerId, language, parameterValue: language, supported: true, reason: null };
  }

  if (providerId === "local-whisper") {
    return { providerId, language, parameterValue: language, supported: true, reason: null };
  }

  return {
    providerId,
    language,
    parameterValue: null,
    supported: false,
    reason: `${providerId} does not support an explicit ${language} language hint`
  };
}
