// Lightweight UUID v4 generator using Web Crypto API (no external dependency)
export function v4(): string {
  return crypto.randomUUID()
}
