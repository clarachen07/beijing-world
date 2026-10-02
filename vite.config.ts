import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

let sha = '';
try {
  const dirty = execSync('git status --porcelain --untracked-files=normal').toString().trim();
  sha = process.env.VITE_SOURCE_SHA || (dirty ? '' : execSync('git rev-parse --short=10 HEAD').toString().trim());
} catch { /* 无 git 时回退分支引用 */ }

export default defineConfig({
  base: './',
  optimizeDeps: { entries: ['index.html'] },
  define: {
    __DEPLOY_SHA__: JSON.stringify(sha),
  },

  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  assetsInclude: ['**/*.bin.gz', '**/*.bin'],
});
