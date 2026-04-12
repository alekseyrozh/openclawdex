import { contextBridge } from "electron";

// Expose a minimal API to the renderer.
// We'll expand this later for CLI spawning.
contextBridge.exposeInMainWorld("codeui", {
  platform: process.platform,
});
