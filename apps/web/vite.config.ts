import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (
            id.includes("/react/")
            || id.includes("/react-dom/")
            || id.includes("/react-router-dom/")
          ) {
            return "react-vendor";
          }
          if (id.includes("/@mui/icons-material/")) {
            return "mui-icons";
          }
          if (
            id.includes("/@mui/material/")
            || id.includes("/@emotion/react/")
            || id.includes("/@emotion/styled/")
          ) {
            return "mui-core";
          }
          if (id.includes("/zrender/")) {
            return "zrender-vendor";
          }
          if (id.includes("/echarts-for-react/")) {
            return "charts-react";
          }
          if (id.includes("/echarts/")) {
            return "echarts-core";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
