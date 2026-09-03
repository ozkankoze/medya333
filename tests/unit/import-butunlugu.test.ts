import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ İMPORT BÜTÜNLÜĞÜ — "bende çalışıyor ama derlemede yok"
 *
 * ⚠️⚠️ SEBEP GERÇEK BİR OLAYDIR. Bir sayfa beş bileşeni import ediyordu;
 * dosyalar diskte vardı, yerelde her şey derleniyordu — ama o dosyalar
 * depoya HİÇ GİRMEMİŞTİ. Vercel deposu klonlayıp derlemeye çalıştı ve
 * "Module not found" ile düştü. Yerelde hiçbir belirti yoktu.
 *
 * Bu test iki şeyi birden doğrular:
 *   1) her yerel import'un hedefi DİSKTE var
 *   2) o dosya GIT TARAFINDAN İZLENİYOR
 *
 * ⚠️ ASIL DEĞER İKİNCİ MADDEDİR. Birincisi zaten `tsc` ile yakalanır;
 * ikincisi yalnızca burada yakalanır ve tam olarak canlıyı kıran şeydir.
 */

const ROOT = path.resolve(__dirname, '../..')

/** Taranan kaynak ağacı — üretime giden her şey. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // ⚠️ Üretilen istemci taranmaz: `src/generated` git'te izlenmeyebilir
    //    ve içeriği bizim yazdığımız kod değildir.
    if (entry === 'generated' || entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = sourceFiles(path.join(ROOT, 'src'))

/** `git ls-files` çıktısı — depoda GERÇEKTEN duran dosyalar. */
function trackedFiles(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    return new Set(out.split('\n').filter(Boolean))
  } catch {
    /**
     * ⚠️ Git yoksa test ÇÖKMEZ ama SESSİZCE GEÇMEZ de: aşağıdaki test
     * bunu ayrıca doğruluyor. Geçici bir ortam eksiği yüzünden kırmızı
     * vermek, testi devre dışı bıraktırır — asıl kaybedilen o olurdu.
     */
    return null
  }
}

const TRACKED = trackedFiles()

/**
 * ⚠️ ÜRETİLEN İSTEMCİ BU KURALIN DIŞINDA. `src/generated/prisma/*` dosyaları
 * derleme sırasında `prisma generate` ile ÜRETİLİR ve bilerek depoya
 * konmaz — Vercel'de de aynı komut çalıştığı için orada mevcut olurlar.
 * Depoda aranmaları yanlış alarm üretirdi.
 */
const URETILEN = /^@\/generated\/|\/generated\//

/** `@/x` ve `./x` biçimindeki YEREL import'lar (paketler hariç). */
const IMPORT = /(?:from|import)\s+['"](\.[^'"]+|@\/[^'"]+)['"]/g

const UZANTILAR = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']

function resolveLocal(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, 'src', spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec)
  for (const ek of UZANTILAR) {
    const aday = base + ek
    if (existsSync(aday) && statSync(aday).isFile()) return aday
  }
  return null
}

// ===========================================================================
describe('import bütünlüğü', () => {
  it('taranacak kaynak dosyalar bulundu', () => {
    // Boş liste, aşağıdaki testleri anlamsızca yeşile çevirirdi.
    expect(FILES.length).toBeGreaterThan(50)
  })

  it('⚠️ HER YEREL IMPORT DİSKTE KARŞILIĞI OLAN BİR DOSYAYA GİDİYOR', () => {
    const kayip: string[] = []
    for (const file of FILES) {
      const body = readFileSync(file, 'utf8')
      for (const m of body.matchAll(IMPORT)) {
        const spec = m[1]!
        // ⚠️ CSS ve varlık import'ları bu kuralın dışında.
        if (/\.(css|svg|png|jpg|webp|json)$/.test(spec)) continue
        if (!resolveLocal(file, spec)) {
          kayip.push(`${path.relative(ROOT, file)} → ${spec}`)
        }
      }
    }
    expect(kayip, 'çözülemeyen import:\n' + kayip.join('\n')).toEqual([])
  })

  it('⚠️⚠️ IMPORT EDİLEN HER YEREL DOSYA GIT TARAFINDAN İZLENİYOR', () => {
    /**
     * Canlıyı kıran tam olarak buydu: dosya diskte vardı, depoda yoktu.
     * `tsc` de `next build` de yerelde sorunsuz geçiyordu çünkü ikisi de
     * diske bakar. Depoyu klonlayan Vercel ise dosyayı bulamadı.
     */
    if (TRACKED === null) {
      throw new Error(
        'git ls-files çalıştırılamadı — bu testin asıl koruması devre dışı kaldı.',
      )
    }
    expect(TRACKED.size, 'git deposunda dosya görünmüyor').toBeGreaterThan(50)

    const izlenmeyen = new Set<string>()
    for (const file of FILES) {
      const body = readFileSync(file, 'utf8')
      for (const m of body.matchAll(IMPORT)) {
        const spec = m[1]!
        if (/\.(css|svg|png|jpg|webp|json)$/.test(spec)) continue
        if (URETILEN.test(spec)) continue
        const hedef = resolveLocal(file, spec)
        if (!hedef) continue
        const rel = path.relative(ROOT, hedef)
        if (!TRACKED.has(rel)) izlenmeyen.add(`${rel}  ←  ${path.relative(ROOT, file)}`)
      }
    }

    expect(
      [...izlenmeyen],
      'Bu dosyalar import ediliyor ama DEPODA YOK — Vercel derlemesi düşer:\n' +
        [...izlenmeyen].join('\n'),
    ).toEqual([])
  })
})
