import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  getSherpaModelById,
  sherpaModelCatalog,
  type SherpaModel,
  type SherpaModelCatalogItem
} from "../shared/sherpa-models";
import { SettingsStore } from "./settings-store";
import { extractTarBz2 } from "./tar-archive";

export interface ResolvedParakeetBundle {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
  bpeVocab: string | null;
}

// Downloads / extracts / verifies the multi-file Parakeet ONNX bundle. Unlike
// ModelService (single-file ggml), the bundle is a `.tar.bz2` that expands into
// `<modelDirectory>/sherpa/<bundleDirName>/`.
export class SherpaModelService {
  constructor(private readonly settingsStore: SettingsStore) {}

  async list(): Promise<SherpaModel[]> {
    const settings = await this.settingsStore.get();

    return Promise.all(
      sherpaModelCatalog.map(async (model) => {
        const bundlePath = this.getBundlePath(settings.modelDirectory, model);
        const downloaded = await this.hasRequiredFiles(bundlePath, model);
        const hotwordsAvailable =
          downloaded &&
          Boolean(model.files.bpeVocab) &&
          (await fileExists(join(bundlePath, model.files.bpeVocab ?? "")));

        return {
          ...model,
          bundlePath,
          status: downloaded ? "downloaded" : "not-downloaded",
          hotwordsAvailable
        };
      })
    );
  }

  async download(modelId: string): Promise<SherpaModel[]> {
    if (process.platform !== "win32") {
      throw new Error("Managed Parakeet model installation is currently Windows-only.");
    }

    const model = getSherpaModelById(modelId);

    if (!model) {
      throw new Error(`Unknown Parakeet model: ${modelId}`);
    }

    const settings = await this.settingsStore.get();
    const sherpaRoot = this.getSherpaRoot(settings.modelDirectory);
    const bundlePath = this.getBundlePath(settings.modelDirectory, model);
    const archivePath = join(sherpaRoot, model.archiveName);
    const temporaryArchivePath = `${archivePath}.download`;

    try {
      await mkdir(sherpaRoot, { recursive: true });
      await rm(bundlePath, { recursive: true, force: true });

      const response = await fetch(model.archiveUrl);

      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to download ${model.name}: ${String(response.status)} ${response.statusText}`
        );
      }

      await pipeline(
        Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(temporaryArchivePath)
      );
      await rm(archivePath, { force: true });
      await rename(temporaryArchivePath, archivePath);
      // The archive already contains a top-level `bundleDirName` folder, so we
      // extract into the sherpa root, not into bundlePath.
      await extractTarBz2(archivePath, sherpaRoot);

      if (!(await this.hasRequiredFiles(bundlePath, model))) {
        throw new Error(
          `Downloaded ${model.name}, but the extracted bundle is missing required ONNX files.`
        );
      }

      // Best-effort: fetch the pre-generated hotwords vocab into the bundle when
      // one is hosted. Failure here must not fail the model download — the model
      // still works with greedy decoding; only hotwords stay unavailable.
      await this.downloadBpeVocab(model, bundlePath);

      return await this.list();
    } catch (error) {
      await rm(bundlePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(temporaryArchivePath, { force: true }).catch(() => undefined);
      await rm(archivePath, { force: true }).catch(() => undefined);
    }
  }

  async delete(modelId: string): Promise<SherpaModel[]> {
    const model = getSherpaModelById(modelId);

    if (!model) {
      throw new Error(`Unknown Parakeet model: ${modelId}`);
    }

    const settings = await this.settingsStore.get();
    const bundlePath = this.getBundlePath(settings.modelDirectory, model);

    await rm(bundlePath, { recursive: true, force: true });

    return this.list();
  }

  async resolveBundlePaths(modelId: string): Promise<ResolvedParakeetBundle | null> {
    const model = getSherpaModelById(modelId);

    if (!model) {
      return null;
    }

    const settings = await this.settingsStore.get();
    const bundlePath = this.getBundlePath(settings.modelDirectory, model);

    if (!(await this.hasRequiredFiles(bundlePath, model))) {
      return null;
    }

    const bpeVocabPath = model.files.bpeVocab
      ? join(bundlePath, model.files.bpeVocab)
      : null;

    return {
      encoder: join(bundlePath, model.files.encoder),
      decoder: join(bundlePath, model.files.decoder),
      joiner: join(bundlePath, model.files.joiner),
      tokens: join(bundlePath, model.files.tokens),
      // bpe.vocab is not part of the published bundle listing; only surface it
      // when it actually exists on disk (Phase 1 plan Step 0.3).
      bpeVocab: bpeVocabPath && (await fileExists(bpeVocabPath)) ? bpeVocabPath : null
    };
  }

  // Downloads the pre-generated `bpe.vocab` (decode-time hotword biasing) into
  // the extracted bundle when the catalog entry declares a `bpeVocabUrl`. No-op
  // when unset. Non-fatal on any failure — hotwords simply stay unavailable.
  private async downloadBpeVocab(
    model: SherpaModelCatalogItem,
    bundlePath: string
  ): Promise<void> {
    if (!model.bpeVocabUrl || !model.files.bpeVocab) {
      return;
    }

    const targetPath = join(bundlePath, model.files.bpeVocab);
    const temporaryPath = `${targetPath}.download`;

    try {
      const response = await fetch(model.bpeVocabUrl);

      if (!response.ok || !response.body) {
        throw new Error(`${String(response.status)} ${response.statusText}`);
      }

      await pipeline(
        Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(temporaryPath)
      );
      await rm(targetPath, { force: true });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      console.warn(
        `Parakeet hotwords vocab download failed for ${model.name}; hotwords stay disabled.`,
        error
      );
    }
  }

  private getSherpaRoot(modelDirectory: string): string {
    return join(modelDirectory, "sherpa");
  }

  private getBundlePath(modelDirectory: string, model: SherpaModelCatalogItem): string {
    return join(this.getSherpaRoot(modelDirectory), model.bundleDirName);
  }

  private async hasRequiredFiles(
    bundlePath: string,
    model: SherpaModelCatalogItem
  ): Promise<boolean> {
    const required = [
      model.files.encoder,
      model.files.decoder,
      model.files.joiner,
      model.files.tokens
    ];

    for (const relativePath of required) {
      if (!(await fileExists(join(bundlePath, relativePath)))) {
        return false;
      }
    }

    return true;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
