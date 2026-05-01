import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
const adapterProxy = {
  "/api": {
    target: "http://127.0.0.1:8787",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, "") || "/",
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: adapterProxy,
  },
  preview: {
    proxy: adapterProxy,
  },
});
