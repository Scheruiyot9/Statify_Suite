/**
 * Compute a deterministic, user-scoped SHA-256 hash of a 4-digit PIN.
 *
 * Format hashed: "<pin>:<userId>"
 *
 * The same hash is stored server-side (for persistence / reset) AND locally
 * in the auth store (for offline unlock without a server round-trip).
 *
 * Uses the Web Crypto API — available in all modern browsers and in Electron.
 */
export async function computePinHash(pin, userId) {
  const data    = `${pin}:${userId}`;
  const encoded = new TextEncoder().encode(data);
  const buf     = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
