"use node";
/**
 * Web Push protocol primitives — RFC 8291 (aes128gcm payload
 * encryption) + RFC 8292 (VAPID) — on Node's crypto. Used ONLY by the
 * "use node" action in convex/pushWeb.ts; kept separate so tests can
 * exercise the full encrypt → decrypt round-trip with throwaway keys.
 *
 * No subscription data ever leaves through here except the encrypted
 * payload itself: the plaintext is the already privacy-safe §6.8
 * notification wording (no names, no phone numbers).
 */
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type ECDH,
} from "node:crypto";

const b64url = (buf: Buffer): string => buf.toString("base64url");
const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** A VAPID key pair (base64url): public = 65-byte uncompressed point,
 *  private = 32-byte scalar. Ops generates one pair per deployment and
 *  stores it in Convex env (RB-8); tests generate throwaway pairs. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh: ECDH = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/** A browser-side subscription key pair + auth secret, for tests. */
export function generateSubscriptionKeys(): {
  p256dh: string;
  privateKey: string;
  auth: string;
} {
  const ecdh: ECDH = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
    auth: b64url(randomBytes(16)),
  };
}

/** The `Authorization` header value for a Web Push request (RFC 8292). */
export function vapidAuthorization(
  audience: string,
  subject: string,
  privateKeyB64: string,
  publicKeyB64: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const pub = fromB64url(publicKeyB64);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64url(pub.subarray(1, 33)),
    y: b64url(pub.subarray(33, 65)),
    d: privateKeyB64,
  };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: subject }),
    ),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${publicKeyB64}`;
}

/**
 * Encrypt a notification payload for one subscription (RFC 8291,
 * aes128gcm content encoding, single record). Returns the full body to
 * POST to the subscription endpoint.
 */
export function encryptWebPushPayload(
  subscription: { p256dh: string; auth: string },
  payload: string,
): Buffer {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);

  const ephemeral: ECDH = createECDH("prime256v1");
  ephemeral.generateKeys();
  const asPublic = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(uaPublic);

  const salt = randomBytes(16);
  const ikm = hkdf(
    shared,
    authSecret,
    Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]),
    32,
  );
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext, tag]);
}

/** Decrypt a body produced by encryptWebPushPayload — test/verification
 *  use (a real browser does this internally with its private key). */
export function decryptWebPushPayload(
  body: Buffer,
  uaPrivateKeyB64: string,
  authB64: string,
): string {
  const salt = body.subarray(0, 16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen, body.length - 16);
  const tag = body.subarray(body.length - 16);

  const ua: ECDH = createECDH("prime256v1");
  ua.setPrivateKey(fromB64url(uaPrivateKeyB64));
  const uaPublic = ua.getPublicKey();
  const shared = ua.computeSecret(asPublic);

  const ikm = hkdf(
    shared,
    fromB64url(authB64),
    Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]),
    32,
  );
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // Strip record padding: zero bytes then the 0x02 final-record marker.
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  if (end > 0 && plain[end - 1] === 0x02) end--;
  return plain.subarray(0, end).toString("utf8");
}
