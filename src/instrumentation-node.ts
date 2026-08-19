import 'server-only'

/**
 * ⭐ YALNIZCA NODE.JS AÇILIŞ KONTROLLERİ (Faz 10)
 *
 * NEDEN AYRI DOSYA?
 *
 * `instrumentation.ts` HEM Node.js HEM Edge runtime için derlenir (middleware
 * varsa Edge derlemesi zorunludur). Veritabanı sürücüsü (`pg`) `fs`, `net` ve
 * `dns` kullanır — Edge derlemesinde bu modüller yoktur ve webpack, kod
 * çalışmayacak olsa bile bağımlılık grafiğini çözmeye çalışıp derlemeyi kırar.
 *
 * Çalışma zamanı kontrolü (`NEXT_RUNTIME !== 'nodejs'` ise erken dön) bunu
 * ÇÖZMEZ: sorun çalışma zamanında değil, DERLEME zamanındadır.
 *
 * Bu yüzden veritabanına dokunan her şey ayrı bir modüldedir ve
 * `instrumentation.ts` onu YALNIZCA Node.js runtime'ında dinamik olarak
 * yükler. Edge derlemesi bu dosyayı hiç görmez.
 */

import { db } from '@/server/db'
import { stampMismatchMessage, verifyDeploymentStamp } from '@/server/deployment-stamp'

/**
 * DAĞITIM DAMGASI — doğru veritabanına mı bağlıyız?
 *
 * Yapılandırma kapısı (`production-guard`) `.env`in İÇERİĞİNE bakar; bu
 * kontrol bağlantının NEREYE gittiğine bakar. İkisi farklı sorulardır:
 * staging'e üretim `DATABASE_URL`i yazıldığında tüm env doğrulamaları geçer.
 *
 * Detay ve bölge matrisi: docs/ENVIRONMENTS.md
 */
export async function checkDeploymentStamp(): Promise<void> {
  const verdict = await verifyDeploymentStamp(db)

  if (verdict.status === 'mismatch') {
    /**
     * ⚠️ BLOCKER — hem canlıda hem canlı dışında.
     *
     * Aşama uyuşmazlığı bir "geliştirme kolaylığı" değildir: yanlış
     * veritabanına yazmak geri alınamaz. Bu yüzden `auditProductionConfig`
     * bulgularının aksine canlı olmayan ortamlarda uyarıya DÜŞMEZ.
     */
    throw new Error(
      'DAĞITIM DAMGASI UYUŞMAZLIĞI — uygulama açılmadı:\n' +
        `  • [DEPLOYMENT_STAMP_MISMATCH] ${stampMismatchMessage(verdict.expected, verdict.found)}`,
    )
  }

  if (verdict.status === 'missing') {
    console.warn(
      '[boot:warning] DEPLOYMENT_STAMP_MISSING — Veritabanı hiçbir ortama damgalanmamış. ' +
        'Yanlış ortama bağlanma koruması devre dışı. Damgalamak için: ' +
        `npm run db:stamp -- --stage=${verdict.expected}`,
    )
    return
  }

  if (verdict.status === 'unreadable') {
    // ⚠️ Uyarı, blocker değil: veritabanına erişilememesi ayrı bir sorundur ve
    // kendi hatasını üretir; damga kapısı onu maskelememelidir.
    console.warn(
      `[boot:warning] DEPLOYMENT_STAMP_UNREADABLE — Damga okunamadı (${verdict.reason}). ` +
        'Veritabanı erişilebilir değil veya migration uygulanmamış olabilir; ' +
        'yanlış ortama bağlanma koruması bu açılışta ÇALIŞMADI.',
    )
    return
  }

  console.warn(`[boot] veritabanı damgası: ${verdict.stampStage} ✓`)
}
