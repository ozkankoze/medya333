import 'server-only'

import { env } from '@/env'
import type { TargetType } from '@/lib/enums'
import { parseTarget } from '@/lib/platforms/parse'
import { avatarProxyPath, storeAvatarFromCdn } from '@/server/media/avatar-store'
import { unverified, type PlatformAdapter, type ResolveOutcome } from '../adapter'
import {
  fetchBusinessDiscovery,
  isBusinessDiscoveryConfigured,
} from './business-discovery'
import {
  readCachedProfile,
  writeCachedFailure,
  writeCachedProfile,
  type CachedProfile,
} from './cache'

/**
 * INSTAGRAM ADAPTER — resmî Meta Business Discovery + fallback akışı
 *
 * DURUM (Ağustos 2026):
 * Profil önizlemesi artık Meta'nın RESMÎ `business_discovery` ucundan gelir.
 * SCRAPING KULLANILMAZ — ne kendi kodumuzla ne üçüncü parti scraping API'siyle.
 *
 * ⚠️ KAPSAM SINIRI DEĞİŞMEDİ. Bu adapter hiçbir hesaba etkileşim göndermez;
 *    yalnızca hedefin doğru girildiğini teyit eder.
 *
 * ⚠️ BUSINESS DISCOVERY HERKESTE ÇALIŞMAZ — VE BU BİR HATA DEĞİLDİR.
 *    Meta, KİŞİSEL (personal) Instagram hesaplarını hiçbir resmî API'den
 *    erişilebilir kılmıyor: *"The Instagram API with Facebook Login cannot
 *    access Instagram consumer accounts."* Hedef professional (Business/
 *    Creator) değilse veri DÖNMEZ. Bu durumda akış, entegrasyondan ÖNCEKİ
 *    davranışın birebir aynısına düşer: kullanıcı kanonik hedefi görür ve
 *    "Bu hedef doğru" onayı verir.
 *
 * ⚠️ FAIL-CLOSED BAYRAK. `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED` kapalıyken
 *    (varsayılan) BU DOSYADAN HİÇBİR AĞ ÇAĞRISI ÇIKMAZ ve davranış
 *    entegrasyon öncesiyle bit-bit aynıdır.
 *
 * ⚠️ SIR SINIRI. `IG_ACCESS_TOKEN` / `IG_USER_ID` yalnızca
 *    `business-discovery.ts` içinde okunur; bu dosya token'ı GÖRMEZ, dönüş
 *    değerine koymaz ve loglamaz.
 */

/** Bayrak kapalıyken UI takipçi/avatar alanlarını hiç göstermemeli. */
const BD_ACTIVE = isBusinessDiscoveryConfigured()

const PROFILE_FALLBACK_REASON =
  // ⚠️ MÜŞTERİ METNİ — teknik terim kullanılmaz ("API", "adapter", "oEmbed").
  //
  // ⚠️ TON: bu bir HATA DEĞİL. Önceki metin ("otomatik olarak alamıyoruz")
  // sistemde bir arıza varmış gibi okunuyordu; oysa Instagram'ın kişisel
  // hesaplar için önizleme vermemesi OLAĞAN durumdur. Metin kullanıcıya
  // yapması gereken tek şeyi söyler. Yine de SAHTE BİR DOĞRULAMA İDDİA
  // ETMEZ — hedefin doğruluğu hâlâ kullanıcının onayına bağlıdır.
  'Instagram profilinizi kontrol edin, doğruluğundan emin olun.'

const POST_FALLBACK_REASON =
  'Instagram gönderileri için otomatik önizleme bulunmuyor. Bağlantının doğru olduğunu kontrol edip onaylayın.'

/**
 * Geçici bir aksaklık mı, hedefin kalıcı bir özelliği mi?
 *
 * Kullanıcıya gösterilen metin buna göre değişir: "şu an ulaşamıyoruz"
 * (geçici) ile "otomatik olarak alamıyoruz" (kalıcı) farklı beklenti kurar.
 */
function reasonFor(failure: string): string {
  switch (failure) {
    case 'timeout':
    case 'network':
    case 'rate_limited':
      return 'Doğrulama servisine şu anda ulaşılamıyor. Hedefi kontrol edip onaylayın.'
    default:
      // not_professional · auth · permission · bad_response · disabled ·
      // not_configured → hepsi kullanıcı için AYNI şey demektir: veri yok.
      // ⚠️ "auth"/"permission" bizim yapılandırma sorunumuzdur; müşteriye
      //    bunu ima etmeyiz, ama SAHTE bir başarı da üretmeyiz.
      return PROFILE_FALLBACK_REASON
  }
}

export const instagramAdapter: PlatformAdapter = {
  key: 'instagram',

  /**
   * ⚠️ BAYRAKTAN TÜRETİLİR, SABİT YAZILMAZ.
   *
   * `capabilities` API cevabına giriyor (`targets/resolve/route.ts`) ve UI
   * takipçi rozetini buna göre çiziyor. Sabit `true` yazmak, entegrasyon
   * kapalıyken "takipçi çekebiliyorum" diyen bir yalan üretirdi.
   */
  capabilities: {
    verifyProfile: BD_ACTIVE,
    verifyPost: false,
    followerCount: BD_ACTIVE,
    /**
     * ⚠️ `false` — BD açıkken bile. Bu bayrak GÖNDERİ küçük resmini ifade
     * eder ve onu alacak resmî bir yol yok (aşağıdaki `resolve()` notuna
     * bakın: oEmbed `thumbnail_url` 3 Kasım 2025'te kaldırıldı).
     *
     * Profil fotoğrafı bundan bağımsızdır ve `verifyProfile` ile gelir.
     * Burada `true` yazmak, YouTube adapter'ındaki mevcut hatanın aynısını
     * üretirdi: UI'a "küçük resim çekebiliyorum" diyen bir yalan.
     */
    thumbnail: false,
    liveMetric: false,
  },

  /**
   * ⚠️ VIDEO dahildir: reel/tv bağlantıları `parseTarget` tarafından gönderi
   * ile AYNI şekilde çözümlenir ve katalogdaki "Görüntülenme" hizmeti VIDEO
   * hedefi kullanır. Liste eksik kaldığında katalog ile adapter sessizce
   * ayrışıyordu (bkz. assertTargetTypeSupported).
   */
  supportedTargetTypes: ['PROFILE', 'POST', 'VIDEO'],

  parse(input: string, targetType: TargetType) {
    return parseTarget('instagram', input, targetType)
  },

  async resolve(normalized, targetType, ctx): Promise<ResolveOutcome> {
    /**
     * --- Gönderi/video: RESMÎ YOL YOK — ARAŞTIRILDI VE KAPATILDI -------------
     *
     * ⚠️ BURAYI YENİDEN AÇMADAN ÖNCE OKUYUN. Bu soru iki kez araştırıldı;
     *    cevap ikisinde de aynı çıktı. Üçüncü kez araştırmayın.
     *
     * 1) `business_discovery` gönderiyi SHORTCODE ile veremez.
     *    `media` edge'i yalnızca hedef hesabın SON gönderilerinin listesidir;
     *    permalink/shortcode ile tekil sorgulama uç noktası YOKTUR. Üstelik
     *    `instagram.com/p/CODE/` biçimi kullanıcı adı taşımadığı için
     *    `business_discovery.username(...)` sorgusu KURULAMAZ bile
     *    (ölçüldü: `parseTarget` → handle = undefined).
     *
     * 2) oEmbed artık görsel VERMİYOR. Meta'nın kendi ifadesiyle
     *    (developers.facebook.com/docs/features-reference/oembed-read/):
     *
     *      "The following fields are no longer returned and will be fully
     *       deprecated on November 3, 2025: author_name, author_url,
     *       thumbnail_height, thumbnail_url, thumbnail_width"
     *
     *    ⚠️ `/docs/instagram-platform/oembed/` sayfası HÂLÂ
     *       `fields=thumbnail_url` örneği gösteriyor — O SAYFA BAYAT.
     *       Otorite sırası: feature-reference + blog duyuruları > reference.
     *
     * 3) Meta'nın önerdiği alternatif — "generate their own thumbnails by
     *    accessing the HTML metadata directly from the Instagram post" —
     *    SCRAPING'dir ve bu projede yasaktır (bkz. adapter.ts başlığı).
     *
     * Sonuç: gönderi/video hedeflerinde önizleme YOKTUR. UI kırık görsel
     * değil, nötr bir yer tutucu gösterir (TargetConfirmCard).
     */
    if (targetType !== 'PROFILE') {
      return unverified(normalized, ctx.canonicalUrl, POST_FALLBACK_REASON)
    }

    // --- Bayrak kapalı: HİÇBİR ağ çağrısı yok, eski davranış aynen ----------
    if (!env.INSTAGRAM_BUSINESS_DISCOVERY_ENABLED) {
      return unverified(normalized, ctx.canonicalUrl, PROFILE_FALLBACK_REASON)
    }

    // --- 1) Önbellek --------------------------------------------------------
    const cached = await readCachedProfile(normalized)
    if (cached.hit && cached.ok) {
      return verifiedFrom(normalized, ctx.canonicalUrl, cached.profile)
    }
    if (cached.hit && !cached.ok) {
      return unverified(normalized, ctx.canonicalUrl, reasonFor(cached.failure))
    }

    // --- 2) Canlı çağrı — ASLA throw etmez ----------------------------------
    const result = await fetchBusinessDiscovery(normalized)

    if (!result.ok) {
      await writeCachedFailure(normalized, result.failure)
      return unverified(normalized, ctx.canonicalUrl, reasonFor(result.failure))
    }

    // --- 3) Avatar: Meta CDN adresi İSTEMCİYE VERİLMEZ, proxy'lenir ---------
    // Başarısız olursa `avatarKey` null kalır; UI platform logosunu gösterir.
    const avatarKey = result.profile.avatarCdnUrl
      ? await storeAvatarFromCdn('instagram', normalized, result.profile.avatarCdnUrl)
      : null

    const profile = {
      displayName: result.profile.displayName,
      externalId: result.profile.externalId,
      biography: result.profile.biography,
      followerCount: result.profile.followerCount,
      mediaCount: result.profile.mediaCount,
      avatarKey,
    }

    await writeCachedProfile(normalized, profile)
    return verifiedFrom(normalized, ctx.canonicalUrl, profile)
  },
}

/**
 * Meta cevabını mevcut `TargetPreview` sözleşmesine çevirir.
 *
 * ⚠️ ALANLAR YALNIZCA GERÇEKTEN VERİ VARSA DOLDURULUR. Meta, Business
 *    Discovery kapsamında `name` ve `profile_picture_url` alanlarını GARANTİ
 *    ETMİYOR (IG User alan tablosunda "Public" işaretleri yok). Eksik geleni
 *    uydurmak yerine `null` bırakırız — UI zaten bu duruma hazır.
 */
function verifiedFrom(
  normalized: string,
  canonicalUrl: string,
  profile: CachedProfile,
): ResolveOutcome {
  return {
    status: 'VERIFIED',
    normalized,
    canonicalUrl,
    // ⚠️ Instagram kullanıcı ID'si — kullanıcı adı değişse bile hedefi
    //    kalıcı olarak bağlar. `Target.externalId` alanına yazılır.
    ...(profile.externalId ? { externalId: profile.externalId } : {}),
    preview: {
      displayName: profile.displayName,
      handle: normalized,
      // ⚠️ Bizim proxy adresimiz. Meta CDN adresi buraya ASLA yazılmaz.
      avatarUrl: profile.avatarKey ? avatarProxyPath(profile.avatarKey) : null,
      followerCount: profile.followerCount,
      isPrivate: false,
      /**
       * ⚠️ `raw` DB'ye `metaSnapshot` olarak yazılıyor. Meta'nın ham cevabını
       *    olduğu gibi saklamak, İMZALI CDN ADRESİNİ veritabanına yazmak
       *    demektir. Yalnızca süzülmüş, adres içermeyen alanları saklarız.
       */
      raw: {
        source: 'instagram_business_discovery',
        id: profile.externalId,
        displayName: profile.displayName,
        biography: profile.biography,
        followerCount: profile.followerCount,
        mediaCount: profile.mediaCount,
        avatarStored: profile.avatarKey !== null,
      },
    },
    method: 'instagram_business_discovery',
  }
}
