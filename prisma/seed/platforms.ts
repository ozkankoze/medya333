/**
 * PLATFORM TOHUM VERİSİ
 *
 * `adapterKey` slug'dan bağımsızdır: admin ileride "Instagram Reels" adında
 * ayrı bir platform açıp adapterKey='instagram' seçerek mevcut doğrulama
 * mantığını yeniden kullanabilir.
 *
 * Adapter'ı olmayan bir platform eklenirse adapterKey='generic' ile çalışır —
 * doğrulama olmaz ama sipariş akışı bozulmaz.
 */

export interface PlatformSeed {
  slug: string
  name: string
  adapterKey: string
  iconSlug: string
  brandColor: string
  sortOrder: number
  seoTitle: string
  seoDescription: string
}

export const PLATFORMS: PlatformSeed[] = [
  {
    slug: 'instagram',
    name: 'Instagram',
    adapterKey: 'instagram',
    iconSlug: 'instagram',
    brandColor: '#E1306C',
    sortOrder: 10,
    seoTitle: 'Instagram Tanıtım Hizmetleri',
    seoDescription:
      'Gerçek kullanıcılarla Instagram hesabınızı büyütmek için profesyonel tanıtım hizmetleri.',
  },
  {
    slug: 'tiktok',
    name: 'TikTok',
    adapterKey: 'tiktok',
    iconSlug: 'tiktok',
    brandColor: '#000000',
    sortOrder: 20,
    seoTitle: 'TikTok Tanıtım Hizmetleri',
    seoDescription: 'TikTok içeriklerinizin erişimini gerçek kullanıcılarla artırın.',
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    adapterKey: 'youtube',
    iconSlug: 'youtube',
    brandColor: '#FF0000',
    sortOrder: 30,
    seoTitle: 'YouTube Tanıtım Hizmetleri',
    seoDescription: 'YouTube kanalınızı ve videolarınızı gerçek izleyicilerle büyütün.',
  },
  {
    slug: 'x',
    name: 'X',
    adapterKey: 'x',
    iconSlug: 'x',
    brandColor: '#0F1419',
    sortOrder: 40,
    seoTitle: 'X (Twitter) Tanıtım Hizmetleri',
    seoDescription: 'X hesabınızın görünürlüğünü gerçek kullanıcılarla artırın.',
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    adapterKey: 'facebook',
    iconSlug: 'facebook',
    brandColor: '#1877F2',
    sortOrder: 50,
    seoTitle: 'Facebook Tanıtım Hizmetleri',
    seoDescription: 'Facebook sayfanızın erişimini gerçek kullanıcılarla genişletin.',
  },
  {
    slug: 'telegram',
    name: 'Telegram',
    adapterKey: 'telegram',
    iconSlug: 'telegram',
    brandColor: '#26A5E4',
    sortOrder: 60,
    seoTitle: 'Telegram Tanıtım Hizmetleri',
    seoDescription: 'Telegram kanalınızı gerçek kullanıcılarla büyütün.',
  },
]
