export type UpdateStatus = {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  installerName: string | null;
  state: "idle" | "checking" | "available" | "downloading" | "installing" | "error";
  error: string | null;
};
