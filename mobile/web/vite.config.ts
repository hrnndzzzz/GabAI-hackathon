import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The production bundle is written straight into the Android app's assets,
// where MainActivity serves it through WebViewAssetLoader.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../app/src/main/assets/www', import.meta.url)),
    emptyOutDir: true,
    // One bundle loaded from the APK's assets; splitting it would only add requests.
    chunkSizeWarningLimit: 900,
  },
})
