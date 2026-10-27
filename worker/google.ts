// Verifies a "Sign in with Google" ID token (RS256 JWT) against Google's public keys.
// No client secret is involved: the token's signature, issuer and audience are enough.

type GoogleClaims = { sub: string; nonce?: string; email: string; email_verified: boolean; given_name?: string; name?: string; aud: string; iss: string; exp: number };
type Jwk = JsonWebKey & { kid: string };

let keys: { list: Jwk[]; until: number } | null = null;

async function googleKeys(): Promise<Jwk[]> {
  if (keys && keys.until > Date.now()) return keys.list;
  // A failed or empty answer is not cached, so the next call tries again.
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    const list = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
    if (list.length) keys = { list, until: Date.now() + maxAge * 1000 };
    return list;
  } catch {
    return [];
  }
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function verifyGoogleToken(token: string, clientId: string): Promise<GoogleClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  let header: { kid?: string; alg?: string };
  let claims: GoogleClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(head)));
    claims = JSON.parse(new TextDecoder().decode(b64url(body)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${head}.${body}`));
  if (!ok) return null;
  if (claims.aud !== clientId) return null;
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
  if (claims.exp * 1000 < Date.now()) return null;
  if (!claims.email_verified) return null;
  return claims;
}
