import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development /api is proxied to the backend (default http://localhost:4000). For a backend
// running HTTPS on a self-signed certificate, set VITE_API_PROXY=https://localhost:4000 and
// VITE_API_PROXY_SELF_SIGNED=true so the proxy accepts that certificate.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost:4000",
        secure: process.env.VITE_API_PROXY_SELF_SIGNED !== "true",
      },
    },
  },
});
