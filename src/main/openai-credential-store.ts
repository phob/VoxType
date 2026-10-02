import { ApiKeyStore } from "./api-key-store";

/** The OpenAI API key, shared by Cloud Dictation and cloud AI cleanup. */
export class OpenAiCredentialStore extends ApiKeyStore {
  constructor() {
    super("openai-api-key.bin", "OPENAI_API_KEY");
  }
}
