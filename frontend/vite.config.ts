import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendTarget = process.env.BACKEND_URL ?? "http://backend:8000";

const proxiedPaths = [
  "/auth",
  "/sources",
  "/categories",
  "/budgets",
  "/transactions",
  "/subscriptions",
  "/stats",
  "/telegram",
  "/healthz",
];

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: Object.fromEntries(
      proxiedPaths.map((p) => [p, { target: backendTarget, changeOrigin: true }])
    ),
  },
});
