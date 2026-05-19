import { type AppProfile, type AppSettings } from "./settings";

export function resolveCloudPromptPackOcrEnabled(
  settings: AppSettings,
  profile: AppProfile | null
): boolean {
  if (typeof profile?.cloudPromptPackOcrEnabled === "boolean") {
    return profile.cloudPromptPackOcrEnabled;
  }

  return settings.cloudPromptPackOcrEnabled;
}
