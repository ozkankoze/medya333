import { NextResponse, type NextRequest } from 'next/server'
import { destroyDbSession } from '@/server/auth/session'
import { apiError, assertSameOrigin, handleUnexpected } from '@/server/http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/auth/logout
 *
 * Oturum satırı VERİTABANINDAN SİLİNİR — yalnızca çerez temizlenmez.
 * Böylece çerezi daha önce kopyalamış biri de içeri giremez.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  try {
    await destroyDbSession()
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleUnexpected('auth.logout', err)
  }
}

export async function GET() {
  return apiError('METHOD_NOT_ALLOWED', 'Bu uç yalnızca POST kabul eder.', 405)
}
