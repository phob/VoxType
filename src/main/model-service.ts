import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getModelById, type LocalModel, whisperModelCatalog } from "../shared/models";
import { SettingsStore } from "./settings-store";

export class ModelService {
  constructor(private readonly settingsStore: SettingsStore) {}

  async list(): Promise<LocalModel[]> {
    const settings = await this.settingsStore.get();

    return Promise.all(
      whisperModelCatalog.map(async (model) => {
        const localPath = join(settings.modelDirectory, model.fileName);
        const downloadedBytes = await getFileSize(localPath);

        return {
          ...model,
          localPath,
          downloadedBytes,
          status: downloadedBytes > 0 ? "downloaded" : "not-downloaded"
        };
      })
    );
  }

  async download(modelId: string): Promise<LocalModel[]> {
    const model = getModelById(modelId);

    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const settings = await this.settingsStore.get();
    const destination = join(settings.modelDirectory, model.fileName);
    const temporaryDestination = `${destination}.download`;

    await mkdir(dirname(destination), { recursive: true });

    const response = await fetch(model.url);

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${model.name}: ${response.status} ${response.statusText}`);
    }

    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      createWriteStream(temporaryDestination)
    );
    await rm(destination, { force: true });
    await rename(temporaryDestination, destination);
    await this.settingsStore.update({ activeModelId: model.id });

    return this.list();
  }

  async delete(modelId: string): Promise<LocalModel[]> {
    const model = getModelById(modelId);

    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const settings = await this.settingsStore.get();
    const destination = join(settings.modelDirectory, model.fileName);

    await rm(destination, { force: true });
    await rm(`${destination}.download`, { force: true });

    if (settings.activeModelId === model.id) {
      const remainingModels = await this.list();
      const nextActiveModel =
        remainingModels.find((item) => item.id !== model.id && item.status === "downloaded")?.id ??
        "small";
      await this.settingsStore.update({ activeModelId: nextActiveModel });
    }

    return this.list();
  }
}

async function getFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
