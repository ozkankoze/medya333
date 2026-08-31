import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ FORM GÖNDERİMİ — "KAYDEDİLEMEDİ" DİYEN AMA KAYDEDEN HATA
 *
 * ⚠️⚠️ BU TESTLER BİR OLAYIN SONUCUDUR VE SİLİNMEMELİDİR.
 *
 * Aylık paket formu "Bağlantı hatası. Tekrar deneyin." veriyordu ve paket
 * kaydedilmiyor sanılıyordu. Tarayıcı testi bunun DOĞRU OLMADIĞINI
 * gösterdi: sunucu 200 dönüyor, kayıt veritabanına yazılıyordu. Üç
 * denemenin üçü de yazıldı; üçünde de ekranda hata göründü.
 *
 * Sebep:
 *
 *     const res = await fetch(...)
 *     e.currentTarget.reset()   // ← React `currentTarget`i temizlemiştir
 *
 * React, olay işleyicisinin senkron bölümü bitince sentetik olayın
 * `currentTarget` alanını boşaltır. `await`ten sonra o değer `null`dur;
 * `null.reset()` bir `TypeError` fırlatır ve genel `catch` bunu "ağ
 * hatası" diye raporlar.
 *
 * Bedeli mesaj yanlışlığından ibaret değildi: kullanıcı hata görüp tekrar
 * bastığı için HER BASIŞ YENİ BİR KAYIT yaratıyordu. Aynı hata kasa
 * hareketi formunda da vardı — orada doğrudan BANKA BAKİYESİNİ çiftliyordu.
 *
 * Aşağıdaki iki kural sınıfı kapatır:
 *   1. `await`ten sonra `e.currentTarget` kullanılmaz.
 *   2. `fetch` doğrudan çağrılmaz; `postJson` kullanılır — o asla `throw`
 *      etmez, dolayısıyla başarı sonrası arayüz işleri `try` dışında kalır
 *      ve bir daha "ağ hatası" diye etiketlenemez.
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx$/.test(full)) out.push(full)
  }
  return out
}

/** Yalnızca istemci bileşenleri — sentetik olay yalnızca orada vardır. */
const clientComponents = walk(SRC).filter((p) => read(p).startsWith("'use client'"))

// ===========================================================================
describe('sentetik olay tuzağı', () => {
  it('taranacak istemci bileşeni bulundu', () => {
    // Boş liste, aşağıdaki testi anlamsızca yeşile çevirirdi.
    expect(clientComponents.length).toBeGreaterThan(5)
  })

  it('⚠️ `await`TEN SONRA `e.currentTarget` KULLANILMIYOR', () => {
    const offenders: string[] = []

    for (const file of clientComponents) {
      const body = stripComments(read(file))
      /**
       * ⚠️ ÖLÇÜ BASİT AMA DOĞRU TARAFTA HATA YAPAR: dosyada hem `await`
       * hem de `await`ten SONRA gelen bir `e.currentTarget` varsa şüpheli
       * sayılır. Yanlış pozitif verebilir; vermesi de sorun değildir,
       * çünkü `currentTarget`i en başta bir değişkene almak her koşulda
       * doğru yazım biçimidir.
       */
      const firstAwait = body.indexOf('await ')
      if (firstAwait === -1) continue

      const after = body.slice(firstAwait)
      const match = /\b(\w+)\.currentTarget/.exec(after)
      if (match) {
        offenders.push(`${path.relative(ROOT, file)} → ${match[0]}`)
      }
    }

    expect(
      offenders,
      'await sonrası currentTarget kullanımı:\n' + offenders.join('\n'),
    ).toEqual([])
  })
})

// ===========================================================================
describe('hata raporlama', () => {
  /** Yazma yapan panel formları — hepsi aynı sözleşmeyi kullanmalı. */
  const WRITING_FORMS = [
    'components/kasa/PackageForm.tsx',
    'components/kasa/KasaEntryForm.tsx',
    'components/kasa/ManualOrderForm.tsx',
  ]

  it('⚠️ KÖR "Bağlantı hatası" MESAJI KALMADI', () => {
    /**
     * Eski metin her istisnayı ağ sorunu ilan ediyordu. Kullanıcı
     * internetini kontrol etmeye yollanıyor, gerçek sebep ise istemci
     * kodundaki bir `TypeError` oluyordu.
     */
    for (const f of WRITING_FORMS) {
      const body = stripComments(read(path.join(SRC, f)))
      expect(body, `${f} hâlâ kör "Bağlantı hatası" gösteriyor`).not.toContain('Bağlantı hatası')
    }
  })

  it('yazan formlar `postJson` sözleşmesini kullanıyor', () => {
    for (const f of WRITING_FORMS) {
      const body = stripComments(read(path.join(SRC, f)))
      expect(body, `${f} postJson kullanmıyor`).toContain('postJson(')
      // Ham `fetch` kalmışsa sözleşme delinmiş demektir.
      expect(body, `${f} içinde ham fetch`).not.toMatch(/\bawait fetch\(/)
    }
  })

  it('⚠️ `postJson` ASLA throw ETMEZ — sözleşmenin tamamı buna dayanır', () => {
    const helper = read(path.join(SRC, 'lib/http/post-json.ts'))
    const code = stripComments(helper)
    expect(code, 'postJson throw ediyor').not.toMatch(/\bthrow\b/)
    // Her iki başarısızlık yolu da yakalanmış olmalı.
    expect(code).toContain('catch')
  })

  it('gerçek hata YALNIZCA geliştirmede konsola yazılır', () => {
    const code = stripComments(read(path.join(SRC, 'lib/http/post-json.ts')))
    expect(code).toContain("process.env.NODE_ENV !== 'production'")
    expect(code).toContain('console.error')
  })

  it('⚠️ ağ hatası ile sunucu hatası AYRI mesaj alır', () => {
    // Hepsine tek mesaj vermek, tam olarak kapattığımız yanılgıyı geri
    // getirirdi: sorun sunucudayken kullanıcıyı internetine baktırmak.
    const code = stripComments(read(path.join(SRC, 'lib/http/post-json.ts')))
    expect(code).toContain('NETWORK_MESSAGE')
    expect(code).toContain('UNEXPECTED_MESSAGE')
    expect(code).toContain('parsed?.error?.message')
  })
})
