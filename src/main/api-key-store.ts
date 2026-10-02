import { app, safeStorage } from "electron";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type OpenAiCredentialStatus } from "../shared/openai-credentials";

/**
 * One provider's API key, encrypted with the Windows account (safeStorage/DPAPI) in the user data folder.
 * An environment variable overrides the stored key.
 */
export class ApiKeyStore {
  private readonly credentialPath: string;

  constructor(
    fileName: string,
    private readonly environmentVariable: string
  ) {
    this.credentialPath = join(app.getPath("userData"), "credentials", fileName);
  }

  async getApiKey(): Promise<string | null> {
    const envKey = process.env[this.environmentVariable]?.trim();

    if (envKey) {
      return envKey;
    }

    try {
      const encrypted = await readFile(this.credentialPath);
      return safeStorage.decryptString(encrypted).trim() || null;
    } catch {
      return null;
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();

    if (!trimmed) {
      await this.clearApiKey();
      return;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is not available on this Windows account.");
    }

    await mkdir(dirname(this.credentialPath), { recursive: true });
    await writeFile(this.credentialPath, safeStorage.encryptString(trimmed), { mode: 0o600 });
    await chmod(this.credentialPath, 0o600).catch(() => undefined);
  }

  async clearApiKey(): Promise<void> {
    await rm(this.credentialPath, { force: true });
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.getApiKey()) !== null;
  }

  async getStatus(): Promise<OpenAiCredentialStatus> {
    const encryptionAvailable = safeStorage.isEncryptionAvailable();

    if (process.env[this.environmentVariable]?.trim()) {
      return { hasApiKey: true, source: "environment", encryptionAvailable };
    }

    try {
      const storedKey = safeStorage.decryptString(await readFile(this.credentialPath)).trim();
      return { hasApiKey: storedKey.length > 0, source: storedKey.length > 0 ? "stored" : "missing", encryptionAvailable };
    } catch {
      return { hasApiKey: false, source: "missing", encryptionAvailable };
    }
  }
}

export class AnthropicCredentialStore extends ApiKeyStore {
  constructor() {
    super("anthropic-api-key.bin", "ANTHROPIC_API_KEY");
  }
}
