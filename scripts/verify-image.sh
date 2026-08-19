#!/usr/bin/env bash
# =============================================================================
#  ÜRETİM İMAJI DENETİMİ (Faz 10)
#
#    ./scripts/verify-image.sh medya333:9f2c1ab
#
#  İmajın İÇİNİ denetler:
#    1. `.env` dosyası var mı?
#    2. Dosya sisteminde sır KALIBI var mı? (PayTR/Resend/Sentry/DB/Redis)
#    3. Katman geçmişinde (`docker history`) sır var mı?
#    4. İmaj ENV'inde sır var mı? (`docker inspect`)
#    5. Dev bağımlılığı taşınmış mı? (vitest/playwright/prisma CLI/typescript)
#    6. Root olarak mı çalışıyor?
#    7. Sağlık ucu tanımlı mı?
#
#  ⚠️ BULUNAN SIRRIN DEĞERİ EKRANA YAZILMAZ — yalnızca hangi kontrolün
#     düştüğü ve hangi DOSYADA bulunduğu bildirilir.
#
#  ⚠️ Bu script GERÇEK bir imaj ister. Docker daemon'ı olmayan bir ortamda
#     çalıştırılamaz ve "çalıştırılmış gibi" raporlanmamalıdır.
# =============================================================================
set -uo pipefail

IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "Kullanım: $0 <imaj:etiket>" >&2
  exit 2
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "İmaj bulunamadı: $IMAGE" >&2
  exit 2
fi

FAIL=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; FAIL=1; }

echo ""
echo "İmaj denetimi: $IMAGE"
echo ""

# --- 1) .env dosyası ---------------------------------------------------------
ENV_FILES=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'find / -xdev \( -name ".env" -o -name ".env.*" \) -not -path "*/node_modules/*" 2>/dev/null' || true)
if [[ -z "$ENV_FILES" ]]; then
  pass ".env dosyası yok"
else
  fail ".env dosyası bulundu:"; echo "$ENV_FILES" | sed 's/^/      /'
fi

# --- 2) Sır KALIPLARI --------------------------------------------------------
# Değişken ADI değil, sırrın BİÇİMİ aranır: değişken adları belgelerde ve
# kod içinde meşru olarak geçer.
PATTERNS='re_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{16,}|postgres(ql)?://[^ "]*:[^ "@]+@|redis://[^ "]*:[^ "@]+@|https://[0-9a-f]{32}@[a-z0-9.-]*sentry|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
HITS=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "grep -rlE '$PATTERNS' /app 2>/dev/null | head -20" || true)
if [[ -z "$HITS" ]]; then
  pass "dosya sisteminde sır kalıbı yok"
else
  fail "sır kalıbı içeren dosya(lar) — DEĞER YAZILMADI:"; echo "$HITS" | sed 's/^/      /'
fi

# --- 3) Katman geçmişi -------------------------------------------------------
# Silinmiş bir dosya bile önceki katmanda durur; `history` build komutlarını
# gösterir ve `--build-arg` ile geçirilen sırlar burada görünür.
if docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGE" \
    | grep -qiE 'SECRET=|PASSWORD=|API_KEY=|MERCHANT_KEY=|MERCHANT_SALT=|TOKEN=[^$]'; then
  fail "katman geçmişinde sır ataması görünüyor (docker history)"
else
  pass "katman geçmişi temiz"
fi

# --- 4) İmaj ENV -------------------------------------------------------------
BAD_ENV=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" \
  | grep -iE '^(AUTH_SECRET|ORDER_TOKEN_SECRET|IP_HASH_SALT|DATABASE_URL|REDIS_URL|RESEND_API_KEY|PAYTR_MERCHANT_KEY|PAYTR_MERCHANT_SALT|PAYTR_MERCHANT_ID|IYZICO_SECRET_KEY|SENTRY_DSN)=.+' \
  | cut -d= -f1 || true)
if [[ -z "$BAD_ENV" ]]; then
  pass "imaj ENV'inde sır yok"
else
  fail "imaj ENV'inde sır tanımlı:"; echo "$BAD_ENV" | sed 's/^/      /'
fi

# APP_ENV imaja gömülmemeli: aynı imaj staging ve canlıda çalışır.
if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | grep -q '^APP_ENV='; then
  fail "APP_ENV imaja gömülmüş — aşamayı imaj değil dağıtım belirlemeli"
else
  pass "APP_ENV imaja gömülmemiş"
fi

# --- 5) Dev bağımlılıkları ---------------------------------------------------
DEV=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'ls -d /app/node_modules/vitest /app/node_modules/@playwright /app/node_modules/typescript /app/node_modules/prisma /app/node_modules/eslint 2>/dev/null' || true)
if [[ -z "$DEV" ]]; then
  pass "dev bağımlılığı yok"
else
  fail "dev bağımlılığı taşınmış:"; echo "$DEV" | sed 's/^/      /'
fi

# --- 6) Non-root -------------------------------------------------------------
USER_ID=$(docker run --rm --entrypoint sh "$IMAGE" -c 'id -u')
if [[ "$USER_ID" == "0" ]]; then
  fail "konteyner ROOT olarak çalışıyor (uid 0)"
else
  pass "non-root çalışıyor (uid $USER_ID)"
fi

# --- 7) Sağlık ucu -----------------------------------------------------------
if docker inspect --format '{{if .Config.Healthcheck}}var{{end}}' "$IMAGE" | grep -q var; then
  pass "HEALTHCHECK tanımlı"
else
  fail "HEALTHCHECK tanımlı değil"
fi

# --- 8) Source map -----------------------------------------------------------
MAPS=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'find /app/.next/static -name "*.js.map" 2>/dev/null | head -5' || true)
if [[ -z "$MAPS" ]]; then
  pass "public source map yok"
else
  fail "public source map servis ediliyor:"; echo "$MAPS" | sed 's/^/      /'
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "SONUÇ: imaj denetimi TEMİZ"
else
  echo "SONUÇ: imaj denetimi DÜŞTÜ — yukarıdaki bulgular giderilmeden dağıtmayın"
fi
echo ""
exit "$FAIL"
