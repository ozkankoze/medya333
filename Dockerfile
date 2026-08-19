# =============================================================================
#  MEDYA 333 — ÜRETİM İMAJI (Faz 10)
#
#  KURALLAR
#    • İmajda SIR BULUNMAZ. `.env` kopyalanmaz, `ARG`/`ENV` ile secret geçilmez.
#      Tüm sırlar ÇALIŞMA ZAMANINDA ortam değişkeni olarak verilir.
#    • İmajda DEV BAĞIMLILIĞI BULUNMAZ. Çalışma katmanı `.next/standalone`
#      çıktısını taşır; `node_modules` klasörü olduğu gibi kopyalanmaz.
#    • Uygulama NON-ROOT çalışır.
#    • Sağlık ucu imajın içinden çağrılabilir (HEALTHCHECK).
#    • Hosting sağlayıcısına özgü hiçbir şey yoktur: çıktı `node server.js`'tir.
#
#  KULLANIM
#    docker build -t medya333:$(git rev-parse --short HEAD) .
#    docker run --env-file /etc/medya333/env -p 3000:3000 medya333:<etiket>
#
#  ⚠️ `--env-file` kullanın; `-e SECRET=...` komut satırı geçmişine ve
#     `docker inspect` çıktısına düşer.
# =============================================================================

# Sürüm SABİTLENMİŞTİR. "node:22-alpine" etiketi zamanla başka bir imajı
# gösterir; aynı Dockerfile'ın iki farklı sonuç üretmesi, geri almayı
# (rollback) güvenilmez kılar.
ARG NODE_VERSION=22.22.2
ARG ALPINE_VERSION=3.21


# -----------------------------------------------------------------------------
# 1) BAĞIMLILIKLAR — üretim + derleme
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
WORKDIR /app

# Prisma'nın OpenSSL araması Alpine'de uyarı üretir; libc6-compat bunu susturur.
RUN apk add --no-cache libc6-compat

# Yalnızca manifest kopyalanır: kaynak değişince bağımlılık katmanı yeniden
# kurulmaz (katman önbelleği).
COPY package.json package-lock.json ./

# ⚠️ `npm ci` — `npm install` DEĞİL. Lock dosyasına birebir uyar; derleme
#    sırasında sürüm yükseltmez.
# ⚠️ Prisma 7 native engine indirmez (queryCompiler/WASM); yine de indirme
#    denemesini kapatıyoruz ki ağı kapalı bir runner'da derleme kırılmasın.
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN npm ci --include=dev --ignore-scripts


# -----------------------------------------------------------------------------
# 2) DERLEME
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules

# ⚠️ Ne kopyalandığı `.dockerignore` ile SINIRLANIR. `.env`, testler,
#    ekran görüntüleri ve `.git` derleme bağlamına HİÇ girmez.
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# ⚠️ DERLEME ANINDA SIR YOKTUR.
#
#    `src/env.ts` boot'ta doğrulama yapar; `next build` sayfa toplarken bu
#    modülü yükler. Derleme makinesinde canlı sırları bulundurmamak için
#    doğrulama derleme adımında atlanır — ÇALIŞMA ZAMANINDA atlanmaz.
#
#    `NEXT_PUBLIC_SITE_URL` derlemeye GÖMÜLÜR ve bir sır değildir; canlı alan
#    adı varsayılan olarak buraya yazılır. Farklı bir alan adı için:
#      docker build --build-arg NEXT_PUBLIC_SITE_URL=https://... .
ARG NEXT_PUBLIC_SITE_URL=https://www.medya333.com
ARG NEXT_PUBLIC_SITE_NAME="Medya 333"
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME}
ENV SKIP_ENV_VALIDATION=true

RUN npx prisma generate && npx next build

# ⚠️⚠️ ÖNEMLİ: `next build` STANDALONE ÇIKTIYA `.env` KOPYALAR.
#
#    Derleme bağlamında bir `.env` varsa Next onu `.next/standalone/.env`
#    olarak yazar ve dosya imaja GİRER. `.dockerignore` bunu zaten engeller
#    (bağlamda `.env` yoktur, dolayısıyla kopyalanacak bir şey de yoktur) —
#    ama bu ikinci savunma hattıdır: `.dockerignore` bozulursa derleme
#    sessizce sır taşıyan bir imaj üretmek yerine KIRILIR.
RUN set -e; \
    if ls -A .env .env.* 2>/dev/null | grep -q .; then \
      echo "HATA: derleme bağlamına .env dosyası girmiş — .dockerignore bozuk"; \
      exit 1; \
    fi; \
    if find .next/standalone -maxdepth 2 -name '.env*' 2>/dev/null | grep -q .; then \
      echo "HATA: standalone çıktısında .env var — imaja sır girecekti"; \
      exit 1; \
    fi


# -----------------------------------------------------------------------------
# 3) ÇALIŞMA — asgari yüzey
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runner
WORKDIR /app

# wget: HEALTHCHECK için (curl'den küçüktür ve BusyBox'ta zaten vardır)
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# ⚠️ APP_ENV BİLEREK YAZILMAZ.
#    Aynı imaj staging'de ve canlıda çalışır; aşamayı imaj değil DAĞITIM
#    belirler. Tanımsız bırakıldığında uygulama fail-closed davranır ve
#    "production" varsayar (bkz. docs/ENVIRONMENTS.md).

# ⚠️ NON-ROOT. node imajında hazır gelen `node` kullanıcısı (uid 1000)
#    kullanılır; yeni kullanıcı yaratmaya gerek yoktur.
#    Dosyalar node'a ait olarak kopyalanır — sonradan `chown -R` katmanı
#    imajı bir kat daha büyütürdü.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# ⚠️ MIGRATION BU İMAJDAN ÇALIŞTIRILMAZ.
#    `prisma migrate deploy` Prisma CLI'ye ihtiyaç duyar; CLI bir DEV
#    bağımlılığıdır ve üretim imajında bilerek YOKTUR. Şema değişikliği
#    uygulamanın yan etkisi olmamalıdır: iki örnek aynı anda açılırsa ikisi
#    birden migration'a girer.
#
#    Migration ve damgalama, repo checkout'u olan ayrı bir bakım adımıdır:
#      npm ci && npm run db:deploy && npm run db:stamp -- --stage=production
#    Sıra ve geri alma: docs/PRODUCTION_RUNBOOK.md § 5

USER node

EXPOSE 3000

# ⚠️ Sağlık ucu: uygulama + veritabanı + Redis. `unavailable` durumunda 503
#    döner ve konteyner sağlıksız işaretlenir (bkz. src/server/health.ts).
#    `/api/health/live` bağımlılıksızdır ve orchestrator'ın liveness probe'u
#    için uygundur; buradaki HEALTHCHECK bilerek BAĞIMLILIKLARI da ölçer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# standalone çıktısının giriş noktası. `npm start` KULLANILMAZ:
# npm bir ara süreç ekler ve SIGTERM'i çocuğuna iletmez → graceful shutdown
# çalışmaz, dağıtım sırasında istekler kesilir.
CMD ["node", "server.js"]
