import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Generic crypto utility service — wallet generation, signing, hashing.
 * For production EVM integration, pair with ethers.js or viem.
 * For Solana, pair with @solana/web3.js.
 * See README.md for full library integration guides.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  // ─── Generic Key Pairs ────────────────────────────────────────────────────

  generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
  }

  // ─── Hashing ──────────────────────────────────────────────────────────────

  sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  sha256Buffer(data: Buffer): Buffer {
    return crypto.createHash('sha256').update(data).digest();
  }

  keccak256(data: string): string {
    // Native keccak256 — for full Ethereum compat use ethers.js
    return crypto.createHash('sha3-256').update(data).digest('hex');
  }

  // ─── HMAC Signing (API signatures, webhook verification) ─────────────────

  hmacSign(data: string, secret: string, algorithm = 'sha256'): string {
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
  }

  hmacVerify(data: string, signature: string, secret: string, algorithm = 'sha256'): boolean {
    const expected = this.hmacSign(data, secret, algorithm);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ─── Encryption/Decryption (AES-256-GCM) ─────────────────────────────────

  encrypt(plaintext: string, keyHex: string): { ciphertext: string; iv: string; tag: string } {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return { ciphertext, iv: iv.toString('hex'), tag };
  }

  decrypt(ciphertext: string, ivHex: string, tagHex: string, keyHex: string): string {
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }

  generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex'); // 256-bit key
  }

  // ─── Random / Tokens ─────────────────────────────────────────────────────

  randomHex(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  randomBase64(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  randomInt(min: number, max: number): number {
    return crypto.randomInt(min, max + 1);
  }

  // ─── Address Generation (Ethereum-like) ──────────────────────────────────

  /**
   * Generates a deterministic mock Ethereum-like address from a seed.
   * For production: use ethers.js Wallet.createRandom() or viem generatePrivateKey().
   */
  generateMockAddress(seed?: string): string {
    const hash = seed
      ? crypto.createHash('sha256').update(seed).digest('hex')
      : crypto.randomBytes(32).toString('hex');
    return '0x' + hash.slice(0, 40);
  }

  // ─── Checksum ─────────────────────────────────────────────────────────────

  checksumPayload(payload: Record<string, any>, secret: string): string {
    const sorted = JSON.stringify(
      Object.keys(payload)
        .sort()
        .reduce((acc, k) => ({ ...acc, [k]: payload[k] }), {}),
    );
    return this.hmacSign(sorted, secret);
  }

  verifyPayloadChecksum(
    payload: Record<string, any>,
    receivedChecksum: string,
    secret: string,
  ): boolean {
    const expected = this.checksumPayload(payload, secret);
    const a = Buffer.from(receivedChecksum);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}
