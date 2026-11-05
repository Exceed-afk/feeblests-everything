// Configuration for the Calculator layout harness only (screenshots at fixed widths).
// Nothing here is part of the app: electron-vite builds main, preload and index.html only.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve('.calch'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/calcPreview.html') }
  },
  server: { port: 5207, strictPort: true },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: resolve('tailwind.config.js') }), autoprefixer()]
    }
  }
})
