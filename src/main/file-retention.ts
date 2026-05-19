import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

type RetainedFile = {
  path: string;
  name: string;
  modifiedAt: number;
};

export async function retainLatestFiles(
  directory: string,
  maximumFiles: number,
  predicate: (fileName: string) => boolean
): Promise<void> {
  if (maximumFiles < 1) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && predicate(entry.name))
        .map(async (entry): Promise<RetainedFile | null> => {
          const path = join(directory, entry.name);
          const metadata = await stat(path).catch(() => null);

          if (!metadata?.isFile()) {
            return null;
          }

          return {
            path,
            name: entry.name,
            modifiedAt: metadata.mtimeMs
          };
        })
    )
  ).filter((file): file is RetainedFile => Boolean(file));

  const expiredFiles = files
    .sort(
      (left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name)
    )
    .slice(maximumFiles);

  await Promise.all(
    expiredFiles.map((file) => rm(file.path, { force: true }).catch(() => undefined))
  );
}

export async function deleteMatchingFiles(
  directory: string,
  predicate: (fileName: string) => boolean
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        await deleteMatchingFiles(path, predicate);
        return;
      }

      if (entry.isFile() && predicate(entry.name)) {
        await rm(path, { force: true }).catch(() => undefined);
      }
    })
  );
}
