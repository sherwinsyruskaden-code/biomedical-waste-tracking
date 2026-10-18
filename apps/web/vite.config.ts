import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "../..", // read VITE_* values from the repository-root .env
  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi (camera/GPS need HTTPS there — see README)
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  preview: { port: 5173, proxy: { "/api": "http://localhost:4000" } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("leaflet")) return "maps";
          if (id.includes("qr-scanner")) return "scanner";
        },
      },
    },
  },
});
