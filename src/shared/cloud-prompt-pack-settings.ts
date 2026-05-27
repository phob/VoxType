import { type AppProfile, type AppSettings } from "./settings";

export function resolveCloudPromptPackOcrEnabled(
  settings: AppSettings,
  profile: AppProfile | null
): boolean {
  return resolveCloudPromptPackOcrPolicy(settings, profile).enabled;
}

export function resolveCloudPromptPackOcrPolicy(
  settings: AppSettings,
  profile: AppProfile | null
): { enabled: boolean; source: "profile" | "global" } {
  if (typeof profile?.cloudPromptPackOcrEnabled === "boolean") {
    return { enabled: profile.cloudPromptPackOcrEnabled, source: "profile" };
  }

  return { enabled: settings.cloudPromptPackOcrEnabled, source: "global" };
}
