import crypto from "crypto";
import "dotenv/config";

const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "utf8");

export function encrypt(text: string) {
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string) {
const buf = Buffer.from(payload, "base64");
const iv = buf.subarray(0, 12);
const tag = buf.subarray(12, 28);
const data = buf.subarray(28);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
return decipher.update(data, undefined, "utf8") + decipher.final("utf8");
}
