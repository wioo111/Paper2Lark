import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: process.env.CARK_SOURCEMAPS === '1' ? 'hidden' : false,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    react(),
  ],
})
