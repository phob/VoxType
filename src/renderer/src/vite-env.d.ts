/// <reference types="vite/client" />

import type { VoxTypeApi } from "../../../preload";

declare global {
  interface Window {
    voxtype: VoxTypeApi;
  }
}
