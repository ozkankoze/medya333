import 'server-only'

import { db } from '@/server/db'
import { dayStartUtc, KasaError } from '@/server/kasa'

/**
 * ⭐ TAKİPÇİ SİPARİŞLERİ VE GÜNLÜK KONTROL — SUNUCU KATMANI
 *
 * ⚠️ PARA YOK. Bu modül hiçbir kasa hareketi, ciro ya da kâr üretmez;
 * `CashEntry` ve `ManualOrder` tablolarına dokunmaz. Tek işi "hangi hesaba
 * hangi gün bakıldı" sorusunu kaydetmektir.
 *
 * ⚠️ YETKİ BURADA DEĞİL, UÇTA (`minimumRole: 'SUPERADMIN'`) — kasa
 * modülünün tamamındaki kural.
 */

/** Izgarada aynı anda gösterilen gün sayısı. */
export const PENCERE_GUN = 14

export interface TakipciSatiri {
  id: string
  username: string
  endCount: number
  note: string | null
  isArchived: boolean
  /** İşaretli günler — `2026-10-23` biçiminde, karşılaştırması kolay olsun diye. */
  isaretliGunler: string[]
  /** Toplam kontrol sayısı (pencere dışındakiler dâhil). */
  toplamKontrol: number
  /** En son hangi gün bakıldı? */
  sonKontrol: Date | null
}

export interface TakipciIzgarasi {
  gunler: Date[]
  satirlar: TakipciSatiri[]
}

/** `2026-10-23` — ızgara anahtarı. */
export function gunAnahtari(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Pencerenin günleri: bitiş gününden geriye doğru `PENCERE_GUN` gün.
 *
 * ⚠️ SOLDAN SAĞA ESKİDEN YENİYE. Ters sıralansaydı, en sık dokunulan sütun
 * (bugün) her ekranda farklı yerde olurdu; göz sabit bir yer ister.
 */
export function pencereGunleri(bitis: Date, adet = PENCERE_GUN): Date[] {
  const son = dayStartUtc(bitis)
  return Array.from({ length: adet }, (_, i) =>
    new Date(son.getTime() - (adet - 1 - i) * 86_400_000),
  )
}

/**
 * Izgara verisi.
 *
 * ⚠️ KONTROLLER TEK SORGUDA çekilir ve bellekte dağıtılır. Satır başına
 * ayrı sorgu, elli hesaplık bir listede elli ek gidiş geliş demekti.
 *
 * ⚠️ PENCERE DIŞINDAKİ İŞARETLER DE SAYILIR ama tek tek taşınmaz: ekranda
 * yalnızca "kaç kez bakıldı" ve "en son ne zaman" görünür.
 */
export async function takipciIzgarasi(params: {
  bitis: Date
  arsiv?: boolean
}): Promise<TakipciIzgarasi> {
  const gunler = pencereGunleri(params.bitis)
  const ilk = gunler[0]!
  const son = gunler[gunler.length - 1]!

  const kayitlar = await db.followerOrder.findMany({
    where: { isArchived: params.arsiv ?? false },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      checks: {
        select: { day: true },
        orderBy: { day: 'desc' },
      },
    },
  })

  const satirlar: TakipciSatiri[] = kayitlar.map((k) => {
    const pencereIci = k.checks
      .filter((c) => c.day >= ilk && c.day <= son)
      .map((c) => gunAnahtari(c.day))
    return {
      id: k.id,
      username: k.username,
      endCount: k.endCount,
      note: k.note,
      isArchived: k.isArchived,
      isaretliGunler: pencereIci,
      toplamKontrol: k.checks.length,
      sonKontrol: k.checks[0]?.day ?? null,
    }
  })

  return { gunler, satirlar }
}

export async function takipciEkle(params: {
  username: string
  endCount: number
  note?: string | null
  createdById?: string | null
}) {
  const username = params.username.trim()
  if (!username) throw new KasaError('GECERSIZ', 'Kullanıcı adı boş olamaz.')
  if (!Number.isInteger(params.endCount) || params.endCount < 0) {
    throw new KasaError('GECERSIZ', 'Bitiş sayısı sıfır ya da daha büyük bir tam sayı olmalı.')
  }

  return db.followerOrder.create({
    data: {
      username,
      endCount: params.endCount,
      note: params.note?.trim() || null,
      createdById: params.createdById ?? null,
    },
    select: { id: true },
  })
}

export async function takipciDuzenle(params: {
  id: string
  username?: string
  endCount?: number
  note?: string | null
  isArchived?: boolean
}) {
  const data: Record<string, unknown> = {}
  if (params.username !== undefined) {
    const u = params.username.trim()
    if (!u) throw new KasaError('GECERSIZ', 'Kullanıcı adı boş olamaz.')
    data.username = u
  }
  if (params.endCount !== undefined) {
    if (!Number.isInteger(params.endCount) || params.endCount < 0) {
      throw new KasaError('GECERSIZ', 'Bitiş sayısı sıfır ya da daha büyük bir tam sayı olmalı.')
    }
    data.endCount = params.endCount
  }
  if (params.note !== undefined) data.note = params.note?.trim() || null
  if (params.isArchived !== undefined) data.isArchived = params.isArchived

  if (Object.keys(data).length === 0) return { id: params.id }
  return db.followerOrder.update({ where: { id: params.id }, data, select: { id: true } })
}

/**
 * ⚠️ SİLMEK KONTROL GEÇMİŞİNİ DE SİLER (veritabanında `onDelete: Cascade`).
 * Bu yüzden arayüzde önce arşivleme sunulur; silme, yanlış açılmış satır
 * içindir.
 */
export async function takipciSil(id: string) {
  await db.followerOrder.delete({ where: { id } })
}

/**
 * Bir günü işaretler ya da işareti kaldırır.
 *
 * ⚠️ İŞARETLEME **FİKİRSİZDİR** (idempotent): aynı gün iki kez
 * işaretlenirse ikinci istek hata vermez, durum aynı kalır. Çift tıklama
 * ya da yavaş bağlantıda tekrar gönderilen istek, ızgarayı bozmamalı.
 *
 * ⚠️ GELECEK GÜN İŞARETLENEMEZ. "Yarın baktım" kaydı, kontrol listesinin
 * tek anlamını (gerçekten bakıldı mı) ortadan kaldırırdı.
 */
export async function kontrolIsaretle(params: {
  orderId: string
  gun: Date
  isaretli: boolean
  bugun?: Date
  createdById?: string | null
}) {
  const gun = dayStartUtc(params.gun)
  const bugun = dayStartUtc(params.bugun ?? new Date())
  if (gun.getTime() > bugun.getTime()) {
    throw new KasaError('GECERSIZ', 'Gelecek bir gün işaretlenemez.')
  }

  if (params.isaretli) {
    await db.followerCheck.upsert({
      where: { orderId_day: { orderId: params.orderId, day: gun } },
      update: {},
      create: { orderId: params.orderId, day: gun, createdById: params.createdById ?? null },
    })
  } else {
    await db.followerCheck.deleteMany({ where: { orderId: params.orderId, day: gun } })
  }

  return { gun: gunAnahtari(gun), isaretli: params.isaretli }
}
