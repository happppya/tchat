/** Express rate-limit configs for auth and general API endpoints. */
import rateLimit from 'express-rate-limit';
import {
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_GIF_MAX,
  RATE_LIMIT_UPLOAD_MAX,
  RATE_LIMIT_WINDOW_MS,
} from './constants';

/**
 * Per-IP request limiters for the endpoints that have real per-request cost.
 * Each endpoint group gets its own bucket; responses carry standard
 * RateLimit-* headers so well-behaved clients can back off.
 */
function createLimiter(max: number, messageText: string) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: messageText },
  });
}

/** Shared by /login and /signup: both run scrypt and mint sessions. */
export const authLimiter = createLimiter(
  RATE_LIMIT_AUTH_MAX,
  'Too many attempts — try again later'
);

export const uploadLimiter = createLimiter(
  RATE_LIMIT_UPLOAD_MAX,
  'Too many uploads — try again later'
);

export const gifLimiter = createLimiter(
  RATE_LIMIT_GIF_MAX,
  'Too many GIF searches — try again later'
);
