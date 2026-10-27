import { existsSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Your own Cloudflare settings live in wrangler.jsonc (npm run setup copies wrangler.example.jsonc). Until it exists,
// the example runs.
const WRANGLER = existsSync("wrangler.jsonc") ? "wrangler.jsonc" : "wrangler.example.jsonc";

export default defineConfig(({ mode }) => {
  // HOPVOTE_LOCAL_ONLY=1, in .env or the environment: no remote bindings, so the app runs without a Cloudflare login.
  // Workers AI has no local mode: writing help and translations are then off on this machine.
  const localOnly = loadEnv(mode, process.cwd(), "HOPVOTE_").HOPVOTE_LOCAL_ONLY === "1";
  return {
    plugins: [react(), cloudflare({ configPath: WRANGLER, remoteBindings: !localOnly })],
    // Port 5180: the test scripts expect it.
    server: { host: true, port: 5180, strictPort: true },
  };
});
