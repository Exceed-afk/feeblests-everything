// Configuration for the design preview only (npm run preview): a plain Vite build of the Review page's design, with
// preview.html as the page. Nothing here is part of the app: electron-vite builds main, preload and index.html only.
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
    outDir: resolve('.preview'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/preview.html') }
  },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: resolve('tailwind.config.js') }), autoprefixer()]
    }
  }
})
