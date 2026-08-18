export { auth, handlers, signIn, signOut, authConfig } from './config'
export { AuthError } from './errors'
export {
  getSessionUser,
  hasRole,
  requireAdmin,
  requireOperator,
  requireRole,
  requireStaff,
  requireSuperAdmin,
  requireUser,
  type SessionUser,
} from './guards'
export { checkPasswordStrength, fakeVerifyDelay, hashPassword, verifyPassword } from './password'
export {
  createDbSession,
  destroyAllSessionsFor,
  destroyDbSession,
  SESSION_MAX_AGE_SECONDS,
} from './session'
export {
  ALL_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_SECURE,
} from './cookies'
