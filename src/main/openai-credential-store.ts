import { safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

const credentialFileName = "openai-api-key.bin";

export class OpenAiCredentialStore {
  private readonly credentialPath = join(app.getPath("userData"), "credentials", credentialFileName);

  async getApiKey(): Promise<string | null> {
    const envKey = process.env.OPENAI_API_KEY?.trim();

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
    await writeFile(this.credentialPath, safeStorage.encryptString(trimmed));
  }

  async clearApiKey(): Promise<void> {
    await rm(this.credentialPath, { force: true });
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.getApiKey()) !== null;
  }
}
