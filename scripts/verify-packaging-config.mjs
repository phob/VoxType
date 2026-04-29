import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const build = packageJson.build ?? {};
const win = build.win ?? {};
const failures = [];

if (build.productName !== "VoxType") {
  failures.push('build.productName must be "VoxType".');
}

if (build.executableName !== "VoxType") {
  failures.push('build.executableName must be "VoxType".');
}

if (win.icon !== "resources/icons/voxtype.ico") {
  failures.push('build.win.icon must point to "resources/icons/voxtype.ico".');
}

if (win.signAndEditExecutable === false) {
  failures.push("build.win.signAndEditExecutable must not be false; it stamps the EXE icon and Windows metadata.");
}

if (failures.length > 0) {
  console.error(`Packaging config is not ready for VoxType Windows releases:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Packaging config is ready for VoxType Windows releases.");
