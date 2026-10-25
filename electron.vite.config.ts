import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// electron-vite builds three separate bundles: main, preload and renderer.
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    css: {
      postcss: {
        plugins: [tailwindcss({ config: resolve('tailwind.config.js') }), autoprefixer()]
      }
    }
  }
})
