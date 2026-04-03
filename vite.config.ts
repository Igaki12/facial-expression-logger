import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/facial-expression-logger/",
  build: {
    outDir: "docs",
  },
  plugins: [react()],
});
