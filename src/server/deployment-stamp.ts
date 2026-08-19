/**
 * ⭐ DAĞITIM DAMGASI — "bu uygulama doğru veritabanına mı bağlı?" (Faz 10)
 *
 * ORTAM AYRIMI NEDEN `.env` İLE YETERSİZ?
 *
 * Staging ile üretimin ayrı `DATABASE_URL` kullanması bir KURALDIR; kuralı
 * uygulayan bir mekanizma yoksa, kuralı bozmak tek bir kopyala-yapıştır
 * kadar uzaktadır. Staging sunucusuna üretim bağlantı adresi yazıldığında:
 *
 *   • hiçbir hata alınmaz,
 *   • staging "çalışıyor" görünür,
 *   • ve staging'de yapılan her test CANLI müşteri verisine yazar.
 *
 * Bu modül, ayrımı veritabanının KENDİSİNE yazar: tek satırlık bir damga.
 * Uygulama açılışta damgayı okur ve kendi aşamasıyla karşılaştırır.
 *
 * KARAR TABLOSU
 *   damga = aşama      → sorun yok
 *   damga ≠ aşama      → BLOCKER: süreç açılmaz
 *   damga yok          → uyarı: eski/yeni kurulumlar kırılmaz, ama görünür olur
 *   damga okunamıyor   → uyarı: veritabanı erişimi ayrı bir sorundur, kapı
 *                        onu maskelememelidir
 *
 * ⚠️ Bu modül `server-only` İTHAL ETMEZ: aynı mantık `scripts/db-stamp.mts`
 * operatör aracından da çağrılır. Prisma istemcisi parametre olarak alınır,
 * böylece modülün kendisi hiçbir bağlantı açmaz.
 */

export type DeploymentStage = 'production' | 'staging' | 'e2e' | 'development'

export const DEPLOYMENT_STAGES: readonly DeploymentStage[] = [
  'production',
  'staging',
  'e2e',
  'development',
]

export const STAMP_ID = 'singleton'

export function isDeploymentStage(value: unknown): value is DeploymentStage {
  return typeof value === 'string' && (DEPLOYMENT_STAGES as readonly string[]).includes(value)
}

/**
 * Bu SÜREÇ hangi aşamada çalışıyor?
 *
 * `APP_ENV` tek doğru kaynaktır (bkz. ADR-027): `next build` ve `next start`
 * `NODE_ENV`i her zaman "production" yapar, dolayısıyla NODE_ENV "canlı mıyız"
 * sorusunu cevaplayamaz.
 *
 * ⚠️ FAIL-CLOSED: `APP_ENV` tanımsız ve `NODE_ENV` de development/test değilse
 * **production** varsayılır. Değişkeni yazmayı unutmak, damga kontrolünü
 * gevşetmez — tam tersine, damgasız/yanlış damgalı bir üretim veritabanına
 * bağlanmayı zorlaştırır.
 */
export function resolveDeploymentStage(
  env: { APP_ENV?: string; NODE_ENV?: string } = process.env,
): DeploymentStage {
  const appEnv = env.APP_ENV?.trim()
  if (appEnv === 'production') return 'production'
  if (appEnv === 'staging') return 'staging'
  if (appEnv === 'e2e') return 'e2e'

  const nodeEnv = env.NODE_ENV?.trim()
  if (nodeEnv === 'development') return 'development'
  if (nodeEnv === 'test') return 'e2e'

  return 'production'
}

export interface DeploymentStampRow {
  stage: string
  label: string | null
  stampedAt: Date
  stampedBy: string | null
}

/** Damga okuma/karşılaştırma için gereken en küçük Prisma yüzeyi. */
export interface StampReader {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}

/**
 * Damgayı okur.
 *
 * `null`  → tablo var ama damga yok (henüz damgalanmamış veritabanı)
 * `throw` → tablo yok veya bağlantı yok (çağıran tarafın kararı)
 *
 * ⚠️ Ham SQL kullanılır çünkü bu kontrol, Prisma istemcisinin şemasıyla
 * veritabanının şeması ayrıştığında bile çalışabilmelidir; ayrıca operatör
 * aracı da aynı fonksiyonu kullanır. Parametreli tagged template ile
 * yazılmıştır — `$queryRawUnsafe` ve string birleştirme YOKTUR.
 */
export async function readDeploymentStamp(client: StampReader): Promise<DeploymentStampRow | null> {
  const rows = (await client.$queryRaw`
    SELECT "stage", "label", "stampedAt", "stampedBy"
    FROM "DeploymentStamp"
    WHERE "id" = ${STAMP_ID}
    LIMIT 1
  `) as DeploymentStampRow[]

  return rows[0] ?? null
}

/**
 * ⭐ İZOLASYON BÖLGESİ — hangi aşamalar aynı veritabanını paylaşabilir?
 *
 * Damgayı aşamaya birebir bağlamak CAZİP ama YANLIŞ olurdu: geliştiricinin
 * makinesinde `npm run dev` (development) ile `npx playwright test` (e2e)
 * AYNI yerel veritabanını kullanır. Birebir eşleşme aransaydı ikisinden biri
 * her zaman açılamazdı — ve o noktada ilk yapılacak şey kontrolü kapatmak
 * olurdu. Kapatılan kontrol, olmayan kontroldür.
 *
 * Gerçekten korunması gereken sınırlar üçtür:
 *   production → yalnızca canlı süreç
 *   staging    → yalnızca staging süreci
 *   local      → geliştirme ve e2e (birbirinin yerine geçebilir)
 */
export type DeploymentRealm = 'production' | 'staging' | 'local'

export function stageRealm(stage: DeploymentStage): DeploymentRealm {
  if (stage === 'production') return 'production'
  if (stage === 'staging') return 'staging'
  return 'local'
}

export type StampVerdict =
  | { status: 'match'; stage: DeploymentStage; stampStage: DeploymentStage }
  | { status: 'mismatch'; expected: DeploymentStage; found: string }
  | { status: 'missing'; expected: DeploymentStage }
  | { status: 'unreadable'; expected: DeploymentStage; reason: string }

/**
 * Damgayı okur ve süreç aşamasıyla karşılaştırır. ASLA FIRLATMAZ —
 * karar (blocker mı uyarı mı) çağırana aittir.
 */
export async function verifyDeploymentStamp(
  client: StampReader,
  stage: DeploymentStage = resolveDeploymentStage(),
): Promise<StampVerdict> {
  let row: DeploymentStampRow | null
  try {
    row = await readDeploymentStamp(client)
  } catch (err) {
    // ⚠️ Hata MESAJI taşınmaz: bağlantı hatalarının metni DATABASE_URL
    // içerebilir (host, kullanıcı adı, bazı sürücülerde parola).
    return {
      status: 'unreadable',
      expected: stage,
      reason: err instanceof Error ? err.name : 'UnknownError',
    }
  }

  if (!row) return { status: 'missing', expected: stage }

  // ⚠️ Tanınmayan bir damga değeri "eşleşti" sayılmaz. Veritabanı CHECK kısıtı
  // bunu zaten engeller; buradaki kontrol, kısıtın kaldırıldığı bir kopyada
  // kapının sessizce açılmamasını garanti eder.
  if (!isDeploymentStage(row.stage)) {
    return { status: 'mismatch', expected: stage, found: row.stage }
  }

  if (stageRealm(row.stage) !== stageRealm(stage)) {
    return { status: 'mismatch', expected: stage, found: row.stage }
  }

  return { status: 'match', stage, stampStage: row.stage }
}

/**
 * Uyuşmazlık mesajı. ⚠️ Bağlantı adresi/host/kullanıcı adı YAZILMAZ:
 * bu metin log'a ve sağlık çıktısına düşebilir.
 */
export function stampMismatchMessage(expected: DeploymentStage, found: string): string {
  return (
    `VERİTABANI ORTAMI UYUŞMUYOR — uygulama aşaması "${expected}", ` +
    `bağlanılan veritabanının damgası "${found}". ` +
    (found === 'production'
      ? 'CANLI VERİTABANINA canlı olmayan bir uygulamadan bağlanılıyor. '
      : '') +
    'DATABASE_URL yanlış ortamı gösteriyor olabilir. ' +
    'Damga doğruysa bağlantıyı düzeltin; veritabanı gerçekten bu ortama ' +
    'aitse `npm run db:stamp -- --stage=<aşama> --force` ile yeniden damgalayın.'
  )
}
