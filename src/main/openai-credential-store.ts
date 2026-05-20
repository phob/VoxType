import { safeStorage } from "electron";
import { type OpenAiCredentialStatus } from "../shared/openai-credentials";
import { chmod } from "node:fs/promises";
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
    const envKey = process.env.OPENAI_API_KEY?.trim();

    if (envKey) {
      return {
        hasApiKey: true,
        source: "environment",
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      };
    }

    try {
      const encrypted = await readFile(this.credentialPath);
      const storedKey = safeStorage.decryptString(encrypted).trim();

      return {
        hasApiKey: storedKey.length > 0,
        source: storedKey.length > 0 ? "stored" : "missing",
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      };
    } catch {
      return {
        hasApiKey: false,
        source: "missing",
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      };
    }
  }
}
