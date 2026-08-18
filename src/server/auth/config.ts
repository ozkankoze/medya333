import 'server-only'

import { PrismaAdapter } from '@auth/prisma-adapter'
import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

import { env } from '@/env'
import type { UserRole } from '@/lib/enums'
import { db } from '@/server/db'
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from './cookies'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: UserRole
      isGuest: boolean
    } & DefaultSession['user']
  }
}

/**
 * AUTH.JS v5 YAPILANDIRMASI
 *
 * Kararlar:
 * - DB oturumu (JWT değil): oturum ANINDA iptal edilebilir. Kullanıcı bloke
 *   edildiğinde veya rolü düşürüldüğünde bir sonraki istekte etkili olur.
 * - Misafir gölge kullanıcılar (isGuest) ile GİRİŞ YAPILAMAZ; sadece sipariş
 *   sahipliği taşırlar. Kişi kayıt olduğunda hesap devralınır.
 *
 * ⚠️ E-POSTA/ŞİFRE GİRİŞİ BURADA DEĞİL.
 * Auth.js v5, Credentials sağlayıcısını veritabanı oturumuyla birlikte
 * kullanmayı reddediyor (`UnsupportedStrategy`). JWT'ye geçmek yerine oturum
 * satırını kendimiz yazıyoruz: `src/server/auth/session.ts` +
 * `POST /api/v1/auth/login`. AYNI `Session` tablosu ve AYNI çerez kullanılır,
 * bu yüzden `auth()` iki akış arasında fark görmez.
 */
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 gün
const adapter = PrismaAdapter(db)

export const authConfig = {
  adapter,

  session: { strategy: 'database', maxAge: SESSION_MAX_AGE, updateAge: 24 * 60 * 60 },

  trustHost: env.AUTH_TRUST_HOST,
  secret: env.AUTH_SECRET,

  pages: {
    signIn: '/giris',
    newUser: '/panel',
    error: '/giris',
  },

  // Çerez adı ve seçenekleri tek kaynaktan (cookies.ts) gelir; e-posta/şifre
  // akışı da AYNI çerezi yazar, böylece iki akış tek oturum modelini paylaşır.
  cookies: {
    sessionToken: { name: SESSION_COOKIE_NAME, options: SESSION_COOKIE_OPTIONS },
  },

  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),

  ],

  callbacks: {
    async session({ session, user }) {
      // Rol her istekte DB'den gelir — JWT'de taşınmaz, böylece rol değişimi anında geçerli olur.
      const dbUser = await db.user.findUnique({
        where: { id: user.id },
        select: { role: true, isGuest: true, isBlocked: true },
      })
      session.user.id = user.id
      session.user.role = (dbUser?.role ?? 'CUSTOMER') as UserRole
      session.user.isGuest = dbUser?.isGuest ?? false
      return session
    },

    async signIn({ user }) {
      if (!user.email) return false
      const existing = await db.user.findUnique({
        where: { email: user.email.toLowerCase() },
        select: { isBlocked: true },
      })
      return !existing?.isBlocked
    },
  },

  events: {
    async signIn({ user }) {
      if (user.id) {
        await db.user
          .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
          .catch(() => undefined)
      }
    },
  },
} satisfies NextAuthConfig

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
