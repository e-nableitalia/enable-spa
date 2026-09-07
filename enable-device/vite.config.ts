/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString('it-IT')),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
          'vendor-chart':    ['chart.js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // Il default di 5000ms produce timeout intermittenti sotto carico (CI,
    // worktree di merge-preview, esecuzioni parallele della suite intera) su
    // test che sotto esecuzione isolata passano in una frazione di quel
    // tempo: non sono test lenti per natura, e' l'ambiente jsdom+userEvent
    // che diventa piu' lento quando gira insieme a molti altri file.
    testTimeout: 15000,
  },
})
