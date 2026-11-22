import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "@/server/errors";

/**
 * AES-256-GCM for secrets stored in the database (project API keys). The key comes from SECRETS_KEY;
 * the stored form is "v1.<iv>.<tag>.<ciphertext>" in base64url.
 */
function key() {
  const k = process.env.SECRETS_KEY;
  if (!k || k.length < 32) throw new AppError(500, "NO_SECRETS_KEY", "SECRETS_KEY (32+ characters) must be set on the server to store project API keys");
  return createHash("sha256").update(k).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string) {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new AppError(500, "BAD_SECRET", "Stored secret has an unknown format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
