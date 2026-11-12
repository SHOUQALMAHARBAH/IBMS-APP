import type { Request } from 'express';

/**
 * THE CLIENT'S NETWORK ADDRESS — one home, because two answers would be two different facts.
 *
 * Extracted from `rate-limit.guard.ts` on 2026-11-12, behaviour-preserving, when the declared-act
 * record (module-1 paper §٨.١, the legal adviser's «وعنوانُ الشبكة») needed the same answer. The
 * guard had the only correct implementation in the codebase and it was PRIVATE, so the second
 * caller's choices were to import it or to write a second one — and a second one is how a system
 * ends up telling an inspector one address while rate-limiting another.
 *
 * The reasoning below is the guard's own, kept verbatim because it was earned by a real
 * vulnerability rather than reasoned from first principles.
 *
 * `x-forwarded-for` is CLIENT-SUPPLIED and trivially spoofable, so it is honoured ONLY when the
 * deployment declares a trusted reverse proxy sets it — `TRUST_PROXY_HEADERS=true`, the same "the
 * deployment target decides" gate `securityHeaders()` and the secure-cookie flag already use.
 *
 * THE HOP MUST BE COUNTED FROM THE RIGHT. Taking `split(',')[0]` — the LEFTMOST value — was the
 * original bug and it left the vulnerability fully open on the exact deployments the flag exists
 * for. Every standard reverse proxy APPENDS the peer it sees to whatever the client already sent
 * (nginx `$proxy_add_x_forwarded_for`, ALB, Cloudflare), so a request arriving with a forged
 * `x-forwarded-for: 1.2.3.4` reaches the app as `1.2.3.4, <real client ip>` and the leftmost read
 * returns the attacker's own value. Rotating it per request then yields a fresh bucket every time:
 * a complete bypass of the brute-force control on login and password reset.
 *
 * The RIGHTMOST entry is the one contributed by the nearest trusted proxy and cannot be forged by
 * the client. `TRUST_PROXY_HOP_COUNT` handles a chain of more than one trusted proxy: with N
 * trusted hops the client's own address is N from the right.
 */
export function clientIpOf(request: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const header = request.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (typeof raw === 'string') {
      const hops = raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const trusted = trustedProxyHopCount();
      const index = hops.length - trusted;
      if (index >= 0 && index < hops.length) return hops[index];
      // Fewer entries than declared hops: the header is not what this deployment says it should
      // be. Fall through to the socket address rather than trust an attacker-controlled position
      // in the list.
    }
  }
  // `request.ip` can be undefined behind some adapters. Everything in that state shares ONE
  // bucket, which is deliberately restrictive rather than permissive: an unidentifiable client
  // gets the smallest possible budget instead of an unlimited one.
  return request.ip ?? 'unknown';
}

/**
 * THE SAME RESOLUTION, FOR A RECORD RATHER THAN A BUCKET — and the difference in the unknown case
 * is the whole reason this is a second function and not a flag.
 *
 * `clientIpOf` returns the STRING `'unknown'` because a rate-limit bucket must exist for every
 * request: an unidentifiable client has to land somewhere, and landing in one shared bucket is the
 * restrictive choice. A RECORD has the opposite requirement. Writing the literal `'unknown'` into
 * `DeclaredAct.networkAddress` would make the column claim an address it does not have, and an
 * inspector reading it could not tell that from a host genuinely named "unknown". So the record
 * gets NULL, which is why that column is nullable.
 */
export function clientIpForRecord(request: Request): string | null {
  const ip = clientIpOf(request);
  return ip === 'unknown' ? null : ip;
}

/** How many trusted proxies sit between the client and this process. Only consulted when
 * `TRUST_PROXY_HEADERS=true`. Defaults to 1 (the common single reverse proxy / load balancer). A
 * value below 1 is meaningless and is clamped — reading the 0th-from-right entry would mean
 * trusting whatever the client sent last. */
function trustedProxyHopCount(): number {
  const parsed = Number.parseInt(process.env.TRUST_PROXY_HOP_COUNT ?? '1', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}
