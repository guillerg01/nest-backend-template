import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(() => {
    service = new WalletService();
  });

  describe('generateKeyPair', () => {
    it('returns PEM-encoded public and private keys', () => {
      const { publicKey, privateKey } = service.generateKeyPair();

      expect(publicKey).toContain('BEGIN PUBLIC KEY');
      expect(privateKey).toContain('BEGIN PRIVATE KEY');
    });

    it('each call generates unique keys', () => {
      const pair1 = service.generateKeyPair();
      const pair2 = service.generateKeyPair();

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
    });
  });

  describe('sha256', () => {
    it('produces deterministic hex hash', () => {
      const hash1 = service.sha256('hello');
      const hash2 = service.sha256('hello');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]+$/);
    });

    it('different inputs produce different hashes', () => {
      expect(service.sha256('hello')).not.toBe(service.sha256('world'));
    });
  });

  describe('hmacSign + hmacVerify', () => {
    const secret = 'my-secret-key';
    const data = 'payload-data';

    it('verifies a correctly signed payload', () => {
      const sig = service.hmacSign(data, secret);
      expect(service.hmacVerify(data, sig, secret)).toBe(true);
    });

    it('rejects tampered signature (different length)', () => {
      const sig = service.hmacSign(data, secret);
      expect(service.hmacVerify(data, sig + 'aa', secret)).toBe(false);
    });

    it('rejects tampered signature (same length, wrong content)', () => {
      const sig = service.hmacSign(data, secret);
      // Flip last two chars to produce wrong-but-same-length signature
      const tampered = sig.slice(0, -2) + (sig.endsWith('00') ? 'ff' : '00');
      expect(service.hmacVerify(data, tampered, secret)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const sig = service.hmacSign(data, 'correct-secret');
      expect(service.hmacVerify(data, sig, 'wrong-secret')).toBe(false);
    });
  });

  describe('encrypt + decrypt', () => {
    it('roundtrips plaintext correctly', () => {
      const key = service.generateEncryptionKey();
      const plaintext = 'super secret message 🔒';

      const { ciphertext, iv, tag } = service.encrypt(plaintext, key);
      const decrypted = service.decrypt(ciphertext, iv, tag, key);

      expect(decrypted).toBe(plaintext);
    });

    it('each encryption produces unique ciphertext (random IV)', () => {
      const key = service.generateEncryptionKey();
      const msg = 'same message';

      const enc1 = service.encrypt(msg, key);
      const enc2 = service.encrypt(msg, key);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });

    it('throws on tampered ciphertext (auth tag check)', () => {
      const key = service.generateEncryptionKey();
      const { ciphertext, iv, tag } = service.encrypt('message', key);
      const badCiphertext = ciphertext.replace(/a/g, 'b').replace(/0/g, '1');

      expect(() => service.decrypt(badCiphertext, iv, tag, key)).toThrow();
    });
  });

  describe('generateEncryptionKey', () => {
    it('returns 64-char hex string (256-bit key)', () => {
      const key = service.generateEncryptionKey();

      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[a-f0-9]+$/);
    });

    it('each call returns unique key', () => {
      expect(service.generateEncryptionKey()).not.toBe(service.generateEncryptionKey());
    });
  });

  describe('randomHex', () => {
    it('returns correct length hex', () => {
      expect(service.randomHex(16)).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(service.randomHex(32)).toHaveLength(64);
    });
  });

  describe('randomInt', () => {
    it('returns value within range', () => {
      for (let i = 0; i < 20; i++) {
        const val = service.randomInt(1, 10);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('generateMockAddress', () => {
    it('returns EVM-style address (0x + 40 hex chars)', () => {
      const addr = service.generateMockAddress('seed');

      expect(addr).toMatch(/^0x[a-f0-9]{40}$/);
    });

    it('same seed = same address (deterministic)', () => {
      expect(service.generateMockAddress('seed')).toBe(service.generateMockAddress('seed'));
    });

    it('no seed = random address', () => {
      expect(service.generateMockAddress()).not.toBe(service.generateMockAddress());
    });
  });

  describe('checksumPayload + verifyPayloadChecksum', () => {
    it('verifies correct payload', () => {
      const payload = { amount: 100, currency: 'USD', userId: 'abc' };
      const secret = 'webhook-secret';

      const checksum = service.checksumPayload(payload, secret);
      expect(service.verifyPayloadChecksum(payload, checksum, secret)).toBe(true);
    });

    it('rejects tampered payload', () => {
      const payload = { amount: 100 };
      const secret = 'secret';
      const checksum = service.checksumPayload(payload, secret);

      expect(service.verifyPayloadChecksum({ amount: 999 }, checksum, secret)).toBe(false);
    });

    it('key order does not affect checksum (sorted)', () => {
      const secret = 'secret';
      const p1 = service.checksumPayload({ a: 1, b: 2 }, secret);
      const p2 = service.checksumPayload({ b: 2, a: 1 }, secret);

      expect(p1).toBe(p2);
    });
  });
});
