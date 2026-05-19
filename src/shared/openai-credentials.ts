export type OpenAiCredentialStatus = {
  hasApiKey: boolean;
  source: "environment" | "stored" | "missing";
  encryptionAvailable: boolean;
};
