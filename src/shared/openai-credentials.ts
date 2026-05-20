export interface OpenAiCredentialStatus {
  hasApiKey: boolean;
  source: "environment" | "stored" | "missing";
  encryptionAvailable: boolean;
}
