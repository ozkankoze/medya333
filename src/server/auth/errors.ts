/**
 * Auth hataları — next-auth'tan BAĞIMSIZ modül.
 *
 * `http.ts` gibi alt katmanlar hata tipine ihtiyaç duyar ama next-auth'u
 * yüklememelidir; aksi halde her route (ve her test) tüm auth zincirini
 * import etmek zorunda kalır.
 */
export class AuthError extends Error {
  constructor(
    readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
