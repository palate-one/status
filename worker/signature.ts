const encoder = new TextEncoder();
const signaturePattern = /^sha256=([0-9a-f]{64})$/;

export type VerifyInput = {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  now: Date;
};

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signBytes(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return new Uint8Array(signed);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function fixedLengthProvidedSignature(signature: string): Promise<Uint8Array> {
  const match = signaturePattern.exec(signature);
  if (match) {
    return fromHex(match[1]);
  }

  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(signature)),
  );
}

export async function signBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  return `sha256=${toHex(await signBytes(secret, timestamp, rawBody))}`;
}

export async function verifySignedBody(input: VerifyInput): Promise<boolean> {
  try {
    const expected = await signBytes(input.secret, input.timestamp, input.rawBody);
    const provided = await fixedLengthProvidedSignature(input.signature);
    const signatureMatches = crypto.subtle.timingSafeEqual(expected, provided);

    if (!/^(0|[1-9][0-9]*)$/.test(input.timestamp)) {
      return false;
    }

    const timestampSeconds = Number(input.timestamp);
    const nowSeconds = input.now.getTime() / 1_000;
    const timestampIsFresh =
      Number.isSafeInteger(timestampSeconds) &&
      Number.isFinite(nowSeconds) &&
      Math.abs(nowSeconds - timestampSeconds) <= 300;

    return signatureMatches && timestampIsFresh;
  } catch {
    return false;
  }
}
