/// <reference types="vite/client" />

import type { VoxTypeApi } from "../../../preload";

declare module "*.onnx?url" {
  const url: string;
  export default url;
}

declare global {
  interface Window {
    voxtype: VoxTypeApi;
  }
}
