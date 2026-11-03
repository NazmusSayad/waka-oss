import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    return { plugins: [react(), tailwindcss()] };
  }

  const password = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "").DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error("DASHBOARD_PASSWORD must be set in the repository root .env");
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      allowedHosts: [".sayad.cc"],
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          headers: { Authorization: `Basic ${Buffer.from(`dev:${password}`).toString("base64")}` },
        },
      },
    },
  };
});
