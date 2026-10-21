function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

async function importEncryptionKey(
  encodedKey: string,
  cryptoApi: Crypto,
): Promise<CryptoKey> {
  const rawKey = fromBase64(encodedKey);
  if (rawKey.byteLength !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }

  return cryptoApi.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  secret: string,
  encodedKey: string,
  associatedData: string,
  cryptoApi: Crypto = crypto,
): Promise<string> {
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(encodedKey, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(new TextEncoder().encode(associatedData)),
    },
    key,
    toArrayBuffer(new TextEncoder().encode(secret)),
  );

  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
  encrypted: string,
  encodedKey: string,
  associatedData: string,
  cryptoApi: Crypto = crypto,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra) {
    throw new Error("Unsupported encrypted secret format");
  }

  const key = await importEncryptionKey(encodedKey, cryptoApi);
  const plaintext = await cryptoApi.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(encodedIv)),
      additionalData: toArrayBuffer(new TextEncoder().encode(associatedData)),
    },
    key,
    toArrayBuffer(fromBase64(encodedCiphertext)),
  );

  return new TextDecoder().decode(plaintext);
}
