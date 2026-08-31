import { NextResponse, type NextRequest } from 'next/server'
import { ROLE_LEVEL } from '@/lib/enums'
import { loginSchema } from '@/lib/validation'
import { writeAudit } from '@/server/audit'
import { fakeVerifyDelay, verifyPassword } from '@/server/auth/password'
import { createDbSession } from '@/server/auth/session'
import { db } from '@/server/db'
import { apiError, assertSameOrigin, handleUnexpected, readJsonBody } from '@/server/http'
import { clientIpFrom, hashIp, rateLimit, rateLimitHeaders } from '@/server/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/auth/yonetim — PERSONEL GİRİŞİ (/yonetim/giris formunun ucu)
 *
 * ⚠️ NEDEN AYRI BİR UÇ? `/api/v1/auth/login` HERKESE oturum açar; müşteri de
 * personel de aynı kapıdan girer. Yönetim kapısının aynı ucu kullanması
 * çalışırdı ama iki şeyi bozardı:
 *
 *   1. Müşteri kimlik bilgisiyle yönetim formundan giriş yapılabilir, sonra
 *      rol kapısına takılırdı. Ekranda "giriş başarılı ama hiçbir şey yok"
 *      durumu doğar — operatör panelin bozuk olduğunu sanır.
 *   2. Panelin kapısı, TÜM kullanıcı tabanı için bir kimlik doğrulama
 *      makinesi hâline gelir. Personel kapısı yalnızca personeli tanımalı.
 *
 * Bu yüzden burada şifre doğrulandıktan SONRA rol de kontrol edilir ve
 * yetersiz rolde OTURUM AÇILMAZ.
 *
 * ⚠️ ROL YETERSİZLİĞİ AYRI BİR MESAJ VERMEZ. "Bu hesap personel değil"
 * demek, saldırgana doğru şifreyi bulduğunu ve yalnızca yanlış hesabı
 * denediğini söylerdi — yani şifre doğrulayıcıya dönüşürdü. Üç durum
 * (e-posta yok / şifre yanlış / rol yetersiz) TEK ve AYNI cevabı alır.
 *
 * ⚠️ MİNİMUM ROL SUPPORT'tur, SUPERADMIN DEĞİL. Kapı panelin tamamınındır;
 * Kasa gibi dar ekranların kendi SUPERADMIN kontrolü ayrıca sayfada ve API
 * ucunda durur. Burada SUPERADMIN istemek, panelin diğer bölümlerine
 * meşru erişimi olan personeli dışarıda bırakırdı.
 *
 * ⚠️ AYRI RATE LIMIT KOVASI. `auth.login.ip` ile paylaşılsaydı, müşteri
 * girişindeki normal trafik personel kapısının bütçesini tüketebilir ve
 * yönetici kendi panelinden kilitlenebilirdi. Ayrıca personel kapısına
 * yapılan deneme sayısı ayrı ölçülebilir olmalı — orası saldırganın
 * ilgilendiği kapıdır.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const ipHash = hashIp(clientIpFrom(req.headers))

  let limit
  try {
    limit = await rateLimit('auth.yonetim.ip', ipHash)
  } catch (err) {
    return handleUnexpected('auth.yonetim', err)
  }
  if (!limit.ok) {
    return apiError('RATE_LIMITED', 'Çok fazla giriş denemesi. Lütfen biraz bekleyin.', 429, {
      headers: rateLimitHeaders(limit),
    })
  }

  const body = await readJsonBody(req)
  if (!body.ok) return body.response

  const parsed = loginSchema.safeParse(body.data)
  if (!parsed.success) {
    await fakeVerifyDelay()
    return apiError('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.', 401)
  }

  // Üç ayrı başarısızlık, TEK cevap. (Bkz. yukarıdaki not.)
  const invalid = () => apiError('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.', 401)

  try {
    const email = parsed.data.email.trim().toLowerCase()
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, isGuest: true, isBlocked: true },
    })

    if (!user?.passwordHash || user.isGuest || user.isBlocked) {
      await fakeVerifyDelay()
      return invalid()
    }

    /**
     * ⚠️ ŞİFRE, ROLDEN ÖNCE DOĞRULANIR. Sıra ters olsaydı (önce rol, sonra
     * şifre) yetersiz rollü hesaplar argon2 doğrulamasını atlar ve cevap
     * ölçülebilir biçimde daha hızlı dönerdi — bu, bir hesabın personel
     * olup olmadığını şifresini bilmeden ölçmeye yarayan bir zamanlama
     * kanalıdır.
     */
    const ok = await verifyPassword(user.passwordHash, parsed.data.password)
    if (!ok) return invalid()

    if (ROLE_LEVEL[user.role] < ROLE_LEVEL.SUPPORT) {
      /**
       * ⚠️ OTURUM AÇILMADAN reddedilir — çerez yazılmaz. Denemenin kaydı
       * yine de tutulur: doğru şifreyle personel kapısını zorlayan bir
       * müşteri hesabı, ele geçirilmiş olabileceği için görülmesi gereken
       * bir olaydır.
       */
      await writeAudit({
        actorId: user.id,
        actorIpHash: ipHash,
        action: 'auth.yonetim.denied',
        entityType: 'User',
        entityId: user.id,
      })
      return invalid()
    }

    await createDbSession(user.id)
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    await writeAudit({
      actorId: user.id,
      actorIpHash: ipHash,
      action: 'auth.yonetim.login',
      entityType: 'User',
      entityId: user.id,
    })

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleUnexpected('auth.yonetim', err)
  }
}
