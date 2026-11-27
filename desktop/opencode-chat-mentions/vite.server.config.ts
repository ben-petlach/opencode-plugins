import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: "src/server.ts", formats: ["es"], fileName: () => "server.js" },
    target: "es2023",
    minify: false,
    rollupOptions: { external: [/^@opencode\/plugin(?:\/|$)/, /^effect(?:\/|$)/, /^node:/] },
  },
})
