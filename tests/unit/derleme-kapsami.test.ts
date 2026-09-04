import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ DERLEME KAPSAMI — "canlı kodda hiçbir kusur yok ama build düşüyor"
 *
 * ⚠️⚠️ SEBEP GERÇEK BİR OLAYDIR. Cihazdaki bağlama noktası `rm`
 * çalıştırmaya izin vermiyor; silinmesi gereken eski kaynak ağaçları bu
 * yüzden DEPO KÖKÜNDEKİ `_to_delete/` klasörüne TAŞINDI. `tsconfig.json`
 * ise depo kökündeki BÜTÜN ".ts" ve ".tsx" dosyalarını tarayan bir desen
 * kullanıyordu — o eski kopyalar da tip denetimine girdi. İçlerinden biri
 * `getPackages(year, month)` çağırıyordu;
 * imza artık üç parametre istiyor. `npm run build` şu hatayla düştü:
 *
 *   _to_delete/_stage.1788209122/.../kasa/page.tsx:55
 *   Expected 3-4 arguments, but got 2
 *
 * ⚠️ HATANIN YERİ YANILTICIDIR: gösterilen dosya artık kullanılmıyordu.
 * Yayınlanan kodda hiçbir sorun yoktu. Kaybedilen zaman, var olmayan bir
 * kusuru aramakla geçti.
 *
 * Bu testin koruduğu üç şey var:
 *   1) `exclude` listesi duruyor (asıl engelleme)
 *   2) `.gitignore` duruyor (o ağaçlar depoya da girmesin)
 *   3) DEPODA gerçekten böyle bir dosya İZLENMİYOR
 *
 * ⚠️ ÜÇÜNCÜSÜ EN ÖNEMLİSİ: ilk ikisi yapılandırmanın ne dediğini, üçüncüsü
 * GERÇEKTE NE OLDUĞUNU ölçer. Yapılandırma doğru görünürken çöp dosyanın
 * çoktan commit edilmiş olması mümkündür.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/** Derlemeye girmemesi gereken geçici/çöp ağaç adları. */
const COP = ['_to_delete', '_stage', '_incoming']

// ===========================================================================
describe('tsconfig kapsamı', () => {
  const tsconfig = JSON.parse(read('tsconfig.json')) as {
    include: string[]
    exclude: string[]
  }

  it('⚠️ TARAMA KÖKTEN BAŞLIYOR — bu yüzden exclude ŞART', () => {
    /**
     * Bu iddia "yanlışı" değil, exclude listesinin NEDEN gerekli olduğunu
     * sabitler. Biri `include`'u `src/**` gibi dar bir desene çevirirse
     * test kırmızı verir ve aşağıdaki kuralların artık gereksiz olduğu
     * fark edilir — sessizce anlamsızlaşmazlar.
     */
    expect(tsconfig.include).toContain('**/*.tsx')
  })

  it('⚠️⚠️ ÇÖP AĞAÇLARI EXCLUDE EDİLMİŞ', () => {
    const liste = tsconfig.exclude.join(' ')
    for (const ad of COP) {
      expect(liste, `tsconfig.json exclude içinde "${ad}" yok`).toContain(ad)
    }
    expect(tsconfig.exclude).toContain('node_modules')
  })
})

// ===========================================================================
describe('gitignore kapsamı', () => {
  const gitignore = read('.gitignore')

  it('çöp ağaçları depoya da girmiyor', () => {
    /**
     * İkinci savunma hattı. Tek başına yetmez — `.gitignore` yalnızca
     * commit'i engeller, tip denetimini engellemez; asıl iş tsconfig'de.
     * İkisi birlikte durmalı.
     */
    for (const ad of COP) {
      expect(gitignore, `.gitignore içinde "${ad}" yok`).toContain(ad)
    }
  })
})

// ===========================================================================
describe('depoda gerçekten yok', () => {
  it('⚠️⚠️ İZLENEN HİÇBİR DOSYA ÇÖP AĞACININ İÇİNDE DEĞİL', () => {
    let tracked: string[]
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
    } catch {
      throw new Error('git ls-files çalıştırılamadı — bu testin koruması devre dışı.')
    }
    expect(tracked.length, 'git deposunda dosya görünmüyor').toBeGreaterThan(50)

    const kirli = tracked.filter((f) =>
      f.split('/').some((seg) => COP.some((ad) => seg === ad || seg.startsWith(ad + '.'))),
    )
    expect(kirli, 'Bu dosyalar depoda ama derlemeye girmemeliler:\n' + kirli.join('\n')).toEqual(
      [],
    )
  })
})
