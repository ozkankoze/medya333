/**
 * ⭐ INSTAGRAM GRAPH API — TOKEN DOĞRULAMA (salt-okunur)
 *
 *   npm run ig:verify
 *   npm run ig:verify -- --target=bilge.kaganla
 *
 * NE YAPAR?
 *   Ortamdaki Instagram yapılandırmasının GERÇEKTEN çalışıp çalışmadığını
 *   Meta'nın resmî Graph API'sine sorarak ölçer. "Değişkeni yazdım" ile
 *   "token geçerli, izinler yerinde, hesap doğru" aynı şey değildir.
 *
 * ⚠️ HİÇBİR ŞEY YAZMAZ. Ne veritabanına, ne Instagram'a, ne dosyaya.
 *    Yalnızca GET istekleri atar. Canlıya karşı güvenle çalıştırılabilir.
 *
 * ⚠️ TOKEN'I ASLA YAZDIRMAZ. Ne başarıda ne hatada. Meta'nın hata metinleri
 *    ve URL'ler token içerir; bu yüzden her çıktı `redact()` süzgecinden
 *    geçer. Sürücü/HTTP hata metinleri olduğu gibi basılmaz.
 *
 * ⚠️ SCRAPING YOK. Yalnızca resmî `graph.facebook.com` uçları.
 */

import { createHash } from 'node:crypto'
import 'dotenv/config'

// --- Ortam (env.ts'i içe aktarmıyoruz: script tüm uygulama şemasını
//     doğrulamak zorunda kalmasın, eksik DATABASE_URL yüzünden patlamasın) ---
/** Boş dize = tanımsız. `.env` şablonu alanları `""` olarak bırakır. */
const read = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

const TOKEN = read('IG_ACCESS_TOKEN')
const USER_ID = read('IG_USER_ID')
const APP_ID = read('IG_APP_ID')
const VERSION = read('IG_GRAPH_API_VERSION') ?? 'v25.0'
/**
 * ⚠️ UYGULAMANIN ŞEMASIYLA BİREBİR AYNI OLMALIDIR (`src/env.ts`).
 *
 * Bu satır önce `/^(1|true|yes)$/i` idi ve uygulamadan AYRIŞMIŞTI: script
 * `"yes"` değerini AÇIK sayarken uygulamanın Zod şeması onu REDDEDİYOR (açılış
 * hatası). Teşhis aracının, teşhis ettiği sistemden farklı kural kullanması,
 * aracın kendisini bir yalan kaynağına çevirir.
 */
const FLAG_RAW = (process.env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED ?? '').trim()
const FLAG_VALID = ['true', 'false', '1', '0', ''].includes(FLAG_RAW)
const FLAG = FLAG_RAW === 'true' || FLAG_RAW === '1'

const targetArg = process.argv.find((a) => a.startsWith('--target='))
const TARGET = targetArg?.slice('--target='.length).replace(/^@/, '').trim()

const GRAPH = `https://graph.facebook.com/${VERSION}`

/** Token, app secret ve access_token query'si çıktıya ASLA sızmasın. */
function redact(text: string): string {
  let out = text
  for (const secret of [TOKEN, process.env.IG_APP_SECRET?.trim()]) {
    if (secret && secret.length > 6) out = out.split(secret).join('<TOKEN GİZLENDİ>')
  }
  return out.replace(/access_token=[^&\s"']+/g, 'access_token=<GİZLENDİ>')
}

function say(line = '') {
  console.log(redact(line))
}

/**
 * Token'ın PARMAK İZİ — değerinin hiçbir parçasını göstermez.
 *
 * ⚠️ Son 4 karakteri göstermek (kredi kartı alışkanlığı) burada YAPILMAZ:
 *    bu çıktı CI log'una, ekran görüntüsüne veya destek talebine düşebilir.
 *    Uzunluk + hash öneki "aynı token mı?" sorusunu aynı derecede iyi
 *    cevaplar ve hiçbir şey sızdırmaz.
 */
function fingerprint(value: string): string {
  const h = createHash('sha256').update(value).digest('hex').slice(0, 8)
  return `${value.length} karakter · parmak izi ${h}`
}

interface GraphResult {
  ok: boolean
  status: number
  body: unknown
  errorMessage?: string
  errorType?: string
  errorCode?: number
}

async function graph(pathAndQuery: string): Promise<GraphResult> {
  const url = `${GRAPH}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN!)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const text = await res.text()
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      // Graph API her zaman JSON döner. JSON değilse araya bir proxy/portal
      // girmiştir — ham gövdeyi BASMAYIZ, token içerebilir.
      return {
        ok: false,
        status: res.status,
        body: null,
        errorMessage: `Graph API JSON olmayan cevap döndü (HTTP ${res.status}). Ağ/proxy engeli olabilir.`,
      }
    }
    const err = body?.error as Record<string, unknown> | undefined
    return {
      ok: res.ok && !err,
      status: res.status,
      body,
      ...(err
        ? {
            errorMessage: String(err.message ?? ''),
            errorType: String(err.type ?? ''),
            errorCode: Number(err.code ?? 0),
          }
        : {}),
    }
  } catch (e) {
    // ⚠️ Yalnızca hata TÜRÜ. İstisna metni isteğin URL'ini — dolayısıyla
    //    `access_token=` query'sini — taşıyabilir.
    const name = e instanceof Error ? e.name : 'bilinmeyen hata'
    return {
      ok: false,
      status: 0,
      body: null,
      errorMessage:
        name === 'AbortError'
          ? 'graph.facebook.com 10 sn içinde cevap vermedi (zaman aşımı)'
          : `graph.facebook.com adresine ulaşılamadı (${name}) — ağ/DNS/firewall engeli olabilir`,
    }
  } finally {
    clearTimeout(timer)
  }
}

let failed = false
const fail = (msg: string) => {
  failed = true
  say(`  ✗ ${msg}`)
}

async function main() {
  say('\n═══ 1) ORTAM DEĞİŞKENLERİ ═══')
  say(`  bayrak INSTAGRAM_BUSINESS_DISCOVERY_ENABLED : ${FLAG ? 'AÇIK' : 'KAPALI'}${FLAG_RAW ? ` ("${FLAG_RAW}")` : ' (tanımsız)'}`)
  if (!FLAG_VALID) {
    fail('Bayrak geçersiz bir değer taşıyor. Şema yalnızca "true" | "false" | "1" | "0" kabul eder;')
    say('     başka bir değerle UYGULAMA AÇILMAZ (bkz. src/env.ts).')
  }
  say(`  IG_GRAPH_API_VERSION                        : ${VERSION}`)
  say(`  IG_APP_ID                                   : ${APP_ID ? 'tanımlı' : '— yok'}`)
  say(`  IG_USER_ID                                  : ${USER_ID ?? '— yok'}`)
  say(`  IG_ACCESS_TOKEN                             : ${TOKEN ? fingerprint(TOKEN) : '— yok'}`)

  if (!TOKEN) {
    say('\n⛔ IG_ACCESS_TOKEN tanımlı değil. .env dosyasını doldurup tekrar çalıştırın.\n')
    process.exitCode = 1
    return
  }

  // --- 2) Token gerçekten geçerli mi? -------------------------------------
  say('\n═══ 2) TOKEN GEÇERLİLİĞİ ═══')
  const me = await graph('/me?fields=id,name')
  if (!me.ok) {
    fail(`Token reddedildi (HTTP ${me.status}, kod ${me.errorCode ?? '?'}): ${me.errorMessage}`)
    if (me.errorCode === 190) {
      say('     → Kod 190: token süresi dolmuş veya iptal edilmiş. Yeni token üretin.')
    }
    say('')
    process.exitCode = 1
    return
  }
  const meBody = me.body as { id?: string; name?: string }
  say(`  ✓ Token geçerli · Facebook kullanıcısı: ${meBody.name ?? '(ad yok)'} (${meBody.id})`)

  // --- 3) İzinler ve son kullanma tarihi ----------------------------------
  say('\n═══ 3) İZİNLER ve SON KULLANMA ═══')
  const REQUIRED = ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement']

  const perms = await graph('/me/permissions')
  if (perms.ok) {
    const granted = new Set(
      ((perms.body as { data?: Array<{ permission: string; status: string }> }).data ?? [])
        .filter((p) => p.status === 'granted')
        .map((p) => p.permission),
    )
    for (const need of REQUIRED) {
      if (granted.has(need)) say(`  ✓ ${need}`)
      else fail(`${need} VERİLMEMİŞ — business_discovery çağrısı reddedilecek`)
    }
    if (granted.has('ads_read') || granted.has('ads_management')) {
      say('  ℹ ads_read/ads_management de var (Business Manager rolleri için gerekebilir)')
    }
  } else {
    say(`  ⚠️ İzin listesi okunamadı (kod ${perms.errorCode ?? '?'}): ${perms.errorMessage}`)
  }

  // `debug_token` app access token ister; APP_ID + APP_SECRET varsa deneriz.
  const appSecret = process.env.IG_APP_SECRET?.trim()
  if (APP_ID && appSecret) {
    const dbgUrl =
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(TOKEN)}` +
      `&access_token=${encodeURIComponent(`${APP_ID}|${appSecret}`)}`
    try {
      const res = await fetch(dbgUrl)
      const body = (await res.json()) as {
        data?: { expires_at?: number; data_access_expires_at?: number; is_valid?: boolean }
      }
      const expiresAt = body.data?.expires_at
      if (expiresAt === 0) {
        say('  ✓ Token süresizmiş (expires_at = 0)')
      } else if (typeof expiresAt === 'number' && expiresAt > 0) {
        const days = Math.floor((expiresAt * 1000 - Date.now()) / 86_400_000)
        const mark = days <= 7 ? '✗' : days <= 21 ? '⚠️' : '✓'
        if (days <= 7) failed = true
        say(`  ${mark} Token ${days} gün sonra doluyor (${new Date(expiresAt * 1000).toISOString().slice(0, 10)})`)
        if (days <= 21) say('     → Yenileyin: uzun ömürlü FB user token ~60 gündür.')
      } else {
        say('  ⚠️ Son kullanma tarihi okunamadı.')
      }
    } catch {
      say('  ⚠️ debug_token çağrılamadı (ağ hatası).')
    }
  } else {
    say('  ℹ IG_APP_ID + IG_APP_SECRET yok → token son kullanma tarihi ÖLÇÜLEMİYOR.')
  }

  // --- 4) IG_USER_ID doğru mu? --------------------------------------------
  say('\n═══ 4) INSTAGRAM HESABI (IG_USER_ID) ═══')
  const pages = await graph('/me/accounts?fields=name,instagram_business_account{id,username}')
  const pageList =
    (pages.body as {
      data?: Array<{ name?: string; instagram_business_account?: { id: string; username?: string } }>
    })?.data ?? []
  const linked = pageList.filter((p) => p.instagram_business_account)

  if (pages.ok && linked.length > 0) {
    say('  Bu token ile erişilebilen Instagram professional hesapları:')
    for (const p of linked) {
      const ig = p.instagram_business_account!
      const mark = ig.id === USER_ID ? '→ IG_USER_ID BU' : '  '
      say(`    ${mark}  ${ig.id}  @${ig.username ?? '?'}   (Sayfa: ${p.name ?? '?'})`)
    }
    if (!USER_ID) {
      fail('IG_USER_ID tanımlı değil. Yukarıdaki ID\'lerden birini .env\'e yazın.')
    } else if (!linked.some((p) => p.instagram_business_account!.id === USER_ID)) {
      fail(`IG_USER_ID=${USER_ID} bu token ile erişilebilir hesaplar arasında YOK.`)
    }
  } else if (pages.ok) {
    fail('Bu token ile Instagram professional hesabına bağlı hiçbir Facebook Sayfası bulunamadı.')
    say('     → Business Discovery, IG hesabına BAĞLI bir Facebook Sayfası gerektirir.')
  } else {
    say(`  ⚠️ Sayfa listesi okunamadı (kod ${pages.errorCode ?? '?'}): ${pages.errorMessage}`)
  }

  // --- 5) Gerçek business_discovery çağrısı -------------------------------
  say('\n═══ 5) BUSINESS DISCOVERY — GERÇEK ÇAĞRI ═══')
  if (!USER_ID) {
    say('  ⏭ IG_USER_ID olmadan çağrılamaz.')
  } else if (!TARGET) {
    say('  ⏭ Hedef verilmedi. Denemek için:')
    say('     npm run ig:verify -- --target=<professional_kullanici_adi>')
    say('     ⚠️ Hedef PROFESSIONAL (Business/Creator) olmalı; kişisel hesaplar dönmez.')
  } else {
    // ⚠️ Uygulamanın istediği alanlarla AYNI liste (business-discovery.ts).
    const fields = 'username,name,id,profile_picture_url,biography,followers_count,media_count'
    const bd = await graph(
      `/${encodeURIComponent(USER_ID)}?fields=business_discovery.username(${encodeURIComponent(TARGET)}){${fields}}`,
    )
    if (bd.ok) {
      const d = (bd.body as { business_discovery?: Record<string, unknown> }).business_discovery
      if (!d) {
        fail(`@${TARGET} için veri dönmedi (cevapta business_discovery alanı yok).`)
      } else {
        say(`  ✓ @${TARGET} çözümlendi:`)
        say(`      kullanıcı adı  : ${d.username ?? '—'}`)
        say(`      görünen ad     : ${d.name ?? '— (Meta bu alanı garanti etmiyor)'}`)
        say(`      takipçi        : ${d.followers_count ?? '—'}`)
        say(`      gönderi        : ${d.media_count ?? '—'}`)
        say(
          `      profil foto    : ${d.profile_picture_url ? 'VAR (imzalı CDN adresi — media-proxy ile servis edilmeli)' : '— (Meta bu alanı garanti etmiyor)'}`,
        )
      }
    } else {
      fail(`business_discovery reddedildi (kod ${bd.errorCode ?? '?'}): ${bd.errorMessage}`)
      if (bd.errorCode === 110 || bd.errorCode === 100) {
        say('     → Muhtemel sebep: hedef KİŞİSEL (personal) hesap, gizli, veya yok.')
        say('       Business Discovery yalnızca professional hesapları görür.')
      }
      if (bd.errorCode === 80002) {
        say('     → Platform rate limit aşıldı (200 × günlük kullanıcı / saat).')
      }
      if (bd.errorCode === 200) {
        say('     → İzin hatası: App Review / Advanced Access tamamlanmamış olabilir.')
      }
    }
  }

  // --- Sonuç ---------------------------------------------------------------
  say('\n' + '─'.repeat(66))
  if (failed) {
    say('⛔ DOĞRULAMA DÜŞTÜ — yukarıdaki ✗ satırlarını giderin.\n')
    process.exitCode = 1
  } else if (!FLAG) {
    say('⚠️  DİKKAT — BU SCRIPT BAYRAĞA BAKMADAN ÇAĞRI YAPAR.')
    say('')
    say('   Yukarıdaki business_discovery çağrısı BAŞARILI olsa bile bu,')
    say('   UYGULAMANIN çalışacağı anlamına GELMEZ: script bayrağı yok sayar,')
    say('   uygulama ise bayrak kapalıyken Graph API\'ye HİÇBİR çağrı yapmaz')
    say('   ve hedefi doğrudan "Doğrulanamadı" akışına düşürür.')
    say('')
    say('   Token, izinler ve hesap erişimi SAĞLAM. Eksik olan tek şey:')
    say('     .env → INSTAGRAM_BUSINESS_DISCOVERY_ENABLED="true"')
    say('   (Vercel kullanıyorsanız orada da Production ortamına ekleyin.)\n')
  } else {
    say('✓ DOĞRULANDI — token geçerli, izinler yerinde, hesap erişilebilir.\n')
  }
}

main().catch((err) => {
  // ⚠️ Yalnızca hata TÜRÜ — istisna metni URL ve dolayısıyla token içerebilir.
  say(`\nDoğrulama çalıştırılamadı: ${err instanceof Error ? err.name : 'bilinmeyen hata'}\n`)
  process.exitCode = 1
})
