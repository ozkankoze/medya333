import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // `server-only` client bundle'da bilerek hata fırlatır; Vitest Node
      // ortamında çalıştığı için paketin boş "react-server" girişine yönlendirilir.
      'server-only': path.resolve(process.cwd(), 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    // .env yüklenir ve DATABASE_URL test veritabanına sabitlenir
    setupFiles: ['tests/env-setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // E2E Playwright ile çalışır, Vitest kapsamı dışında
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Entegrasyon testleri modül düzeyinde env okur → dosya başına izole süreç
    pool: 'forks',
    // Testcontainers ilk çalıştırmada imaj indirebilir
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
})
