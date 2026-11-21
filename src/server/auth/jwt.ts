// Edge-safe (no Node or Prisma imports) so proxy.ts can verify sessions too.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "metech_session";

export type Role = "OWNER" | "ACCOUNTANT" | "SALES" | "VIEWER";

export interface SessionClaims {
  sub: string;
  role: Role;
  sv: number;
}

function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims, ttlHours: number) {
  return new SignJWT({ role: claims.role, sv: claims.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("metech-erp")
    .setExpirationTime(`${ttlHours}h`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "metech-erp", algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string") return null;
    return { sub: payload.sub, role: payload.role as Role, sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}
