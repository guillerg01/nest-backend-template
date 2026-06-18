# Crypto Module

Node.js built-in crypto, blockchain read operations, and guides for full wallet management (ethers.js, viem, Solana, Bitcoin).

---

## Table of Contents

1. [Node.js Crypto (Built-in)](#nodejs-crypto)
2. [Blockchain Read Operations](#blockchain-read-operations)
3. [Full Wallet Management — ethers.js (README only)](#ethersjs-wallet-management)
4. [Viem Alternative](#viem-alternative)
5. [Solana: @solana/web3.js](#solana)
6. [Bitcoin: bitcoinjs-lib](#bitcoin)
7. [Moralis API](#moralis-api)
8. [Alchemy SDK](#alchemy-sdk)
9. [NFT Minting Patterns](#nft-minting)
10. [DeFi Interaction](#defi-interaction)
11. [Security: Key Management (CRITICAL)](#security-key-management)

---

## Node.js Crypto (Built-in)

No dependencies required. Use for: encrypting sensitive DB fields, HMAC signing, webhook verification, secure token generation.

### AES-256-GCM Encryption

GCM mode provides **authenticated encryption** — it guarantees both confidentiality AND integrity. If the ciphertext is tampered with, decryption fails rather than returning garbage data.

```typescript
// crypto.service.ts
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly IV_LENGTH = 12;  // 96 bits — recommended for GCM
  private readonly AUTH_TAG_LENGTH = 16; // 128 bits

  private key: Buffer;

  constructor(private configService: ConfigService) {
    const keyHex = this.configService.get<string>('ENCRYPTION_KEY');
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Combine iv + authTag + encrypted — all needed for decryption
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64url');
  }

  decrypt(encryptedData: string): string {
    const combined = Buffer.from(encryptedData, 'base64url');

    const iv = combined.slice(0, this.IV_LENGTH);
    const authTag = combined.slice(this.IV_LENGTH, this.IV_LENGTH + this.AUTH_TAG_LENGTH);
    const encrypted = combined.slice(this.IV_LENGTH + this.AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
```

Generate encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### HMAC Signing (Webhook Verification)

```typescript
// Signing outgoing webhooks (so receivers can verify they came from you)
signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Verifying incoming webhooks (e.g., from Stripe, GitHub, etc.)
verifyWebhookSignature(
  payload: string,
  receivedSignature: string,
  secret: string,
): boolean {
  const expectedSignature = this.signPayload(payload, secret);

  // IMPORTANT: use timingSafeEqual to prevent timing attacks
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(receivedSignature);

  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}
```

### Secure Token Generation

```typescript
// Generate cryptographically secure random tokens
generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex'); // 64 char hex string
}

generateOtp(digits = 6): string {
  const max = Math.pow(10, digits);
  const randomBytes = crypto.randomBytes(4);
  const num = randomBytes.readUInt32BE(0) % max;
  return num.toString().padStart(digits, '0');
}
```

### Use Cases for Built-in Crypto

| Use Case | Method | Notes |
|---|---|---|
| Encrypt 2FA secret in DB | AES-256-GCM | Never store TOTP secrets plaintext |
| Encrypt PII fields (SSN, DOB) | AES-256-GCM | GDPR compliance |
| Password reset tokens | `randomBytes().hex()` | Store only the hash |
| API key generation | `randomBytes(32).hex()` | Store only the hash |
| Webhook signature verification | HMAC-SHA256 + timingSafeEqual | GitHub, Stripe, Shopify |
| CSRF tokens | `randomBytes(32).base64url()` | Unique per session |

---

## Blockchain Read Operations

Reading public blockchain data requires no wallet or private key.

```bash
npm install ethers
```

```typescript
// blockchain-reader.service.ts
import { ethers } from 'ethers';

@Injectable()
export class BlockchainReaderService {
  private provider: ethers.JsonRpcProvider;

  constructor(private configService: ConfigService) {
    // Use Alchemy, Infura, or public RPC endpoints
    this.provider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${this.configService.get('ALCHEMY_API_KEY')}`
    );
  }

  async getEthBalance(address: string): Promise<string> {
    const balance = await this.provider.getBalance(address);
    return ethers.formatEther(balance); // returns '1.5' for 1.5 ETH
  }

  async getTransaction(txHash: string): Promise<ethers.TransactionResponse | null> {
    return this.provider.getTransaction(txHash);
  }

  async getTokenBalance(
    tokenAddress: string,
    walletAddress: string,
  ): Promise<string> {
    // Standard ERC-20 ABI subset (just balanceOf and decimals)
    const erc20Abi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ];

    const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(walletAddress),
      contract.decimals(),
    ]);

    return ethers.formatUnits(balance, decimals);
  }

  async getEthPrice(): Promise<number> {
    // Chainlink ETH/USD price feed on mainnet
    const priceFeedAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
    const aggregatorAbi = [
      'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
    ];

    const priceFeed = new ethers.Contract(priceFeedAddress, aggregatorAbi, this.provider);
    const [, price] = await priceFeed.latestRoundData();
    return Number(price) / 1e8; // Chainlink uses 8 decimals
  }
}
```

---

## ethers.js Wallet Management

> Not implemented in this template. This section documents the patterns.
> Install: `npm install ethers`

```typescript
import { ethers } from 'ethers';

// Generate a new wallet
const wallet = ethers.Wallet.createRandom();
console.log(wallet.address);      // '0x...'
console.log(wallet.privateKey);   // '0x...' — NEVER log this in production
console.log(wallet.mnemonic.phrase); // 12-word seed phrase

// Restore from mnemonic (HD Wallet)
const hdWallet = ethers.HDNodeWallet.fromPhrase('word1 word2 ... word12');
// Derive child wallets from same seed (BIP-44 path)
const child0 = hdWallet.derivePath("m/44'/60'/0'/0/0");
const child1 = hdWallet.derivePath("m/44'/60'/0'/0/1");

// Connect to provider to send transactions
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const connectedWallet = wallet.connect(provider);

// Send ETH
const tx = await connectedWallet.sendTransaction({
  to: '0xRecipientAddress',
  value: ethers.parseEther('0.01'), // 0.01 ETH
});
const receipt = await tx.wait(); // wait for confirmation

// Interact with a smart contract
const contract = new ethers.Contract(
  contractAddress,
  contractAbi,
  connectedWallet // use provider for reads, signer (wallet) for writes
);

// Read (free, no gas)
const balance = await contract.balanceOf(walletAddress);

// Write (costs gas)
const tx2 = await contract.transfer(recipientAddress, amount);
await tx2.wait();

// Listen to events
contract.on('Transfer', (from, to, amount, event) => {
  console.log(`Transfer: ${from} → ${to}: ${ethers.formatEther(amount)}`);
});
```

---

## Viem Alternative

Viem is the modern alternative to ethers.js. Tree-shakeable, better TypeScript, no classes.

```bash
npm install viem
```

```typescript
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Read-only client
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL),
});

const balance = await publicClient.getBalance({
  address: '0xAddress',
});
console.log(formatEther(balance));

// Write client (requires private key — see security section)
const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(process.env.RPC_URL),
});

const txHash = await walletClient.sendTransaction({
  to: '0xRecipient',
  value: parseEther('0.01'),
});
```

**Viem vs ethers.js:**
- Viem: better TypeScript, tree-shakeable, functional style, more active development
- ethers.js: more ecosystem support, more tutorials/examples online
- Either is fine. New projects should prefer viem.

---

## Solana

```bash
npm install @solana/web3.js
```

```typescript
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// Connect to cluster
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Generate wallet
const keypair = Keypair.generate();
console.log(keypair.publicKey.toBase58()); // Solana address

// Restore from secret key
const restored = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));

// Get SOL balance
const publicKey = new PublicKey('SolanaAddress');
const balance = await connection.getBalance(publicKey);
console.log(balance / LAMPORTS_PER_SOL); // convert lamports to SOL

// Transfer SOL
const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: recipientPublicKey,
    lamports: 0.01 * LAMPORTS_PER_SOL,
  })
);

const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);
```

---

## Bitcoin

```bash
npm install bitcoinjs-lib ecpair tiny-secp256k1
```

```typescript
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

// Generate wallet
const keyPair = ECPair.makeRandom();
const { address } = bitcoin.payments.p2wpkh({
  pubkey: Buffer.from(keyPair.publicKey),
  network: bitcoin.networks.mainnet,
});

console.log(address); // bc1q... (native SegWit)

// Testnet address
const { address: testnetAddress } = bitcoin.payments.p2wpkh({
  pubkey: Buffer.from(keyPair.publicKey),
  network: bitcoin.networks.testnet,
});
```

---

## Moralis API

Full blockchain data platform — NFTs, tokens, transactions, DeFi data. Great for building blockchain explorers or portfolio trackers.

```bash
npm install moralis
```

```typescript
import Moralis from 'moralis';

await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });

// Get NFTs owned by address
const nfts = await Moralis.EvmApi.nft.getWalletNFTs({
  address: walletAddress,
  chain: '0x1', // Ethereum mainnet
});

// Get token balances
const tokens = await Moralis.EvmApi.token.getWalletTokenBalances({
  address: walletAddress,
  chain: '0x1',
});

// Get transaction history
const txs = await Moralis.EvmApi.transaction.getWalletTransactions({
  address: walletAddress,
  chain: '0x1',
});
```

**Docs:** [docs.moralis.io](https://docs.moralis.io)

---

## Alchemy SDK

Enterprise blockchain infrastructure and data.

```bash
npm install alchemy-sdk
```

```typescript
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

// Get NFTs
const nfts = await alchemy.nft.getNftsForOwner(walletAddress);

// Enhanced transaction
const tx = await alchemy.core.getTransactionReceipt(txHash);

// Token metadata
const metadata = await alchemy.token.getTokenMetadata(tokenAddress);
```

---

## NFT Minting Patterns

> Not implemented — documentation only.

```typescript
// ERC-721 minting (assuming contract is deployed)
const nftContract = new ethers.Contract(
  contractAddress,
  ['function mint(address to, string uri) returns (uint256)'],
  connectedWallet,
);

// Upload metadata to IPFS first (use NFT.Storage or Pinata)
const metadataUri = 'ipfs://QmYourMetadataHash';

const tx = await nftContract.mint(recipientAddress, metadataUri);
const receipt = await tx.wait();

// Get token ID from event
const event = receipt.logs[0];
const tokenId = event.topics[3]; // Transfer event: from, to, tokenId
```

---

## DeFi Interaction

> Not implemented — documentation only.

```typescript
// Get Uniswap V3 quote (read-only, no gas)
const QUOTER_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const quoterAbi = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];

const quoter = new ethers.Contract(QUOTER_ADDRESS, quoterAbi, provider);
const amountOut = await quoter.quoteExactInputSingle.staticCall(
  WETH_ADDRESS,
  USDC_ADDRESS,
  3000, // 0.3% fee tier
  ethers.parseEther('1'), // 1 ETH
  0,
);
console.log(`1 ETH = ${ethers.formatUnits(amountOut, 6)} USDC`);
```

---

## Security: Key Management (CRITICAL)

This is the most important section in this file.

### NEVER Do This

```bash
# NEVER store private keys in environment variables in production
PRIVATE_KEY=0xdeadbeef...  # anyone who reads your .env, logs, or CI secrets = owns your wallet
```

### Production Key Management Options

| Solution | Complexity | Cost | Use Case |
|---|---|---|---|
| AWS KMS | Medium | Pay per use (~$1/10k calls) | AWS-hosted apps, server-side signing |
| HashiCorp Vault | High | Self-hosted or managed | Multi-cloud, enterprise |
| Hardware Security Module (HSM) | Very High | $$ | Financial apps, exchanges |
| Google Cloud KMS | Medium | Pay per use | GCP-hosted apps |
| Azure Key Vault | Medium | Pay per use | Azure-hosted apps |

### AWS KMS Pattern

```typescript
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';

@Injectable()
export class KmsSigningService {
  private kms = new KMSClient({ region: 'us-east-1' });

  async signTransaction(txHash: Buffer): Promise<Buffer> {
    const command = new SignCommand({
      KeyId: process.env.KMS_KEY_ID,
      Message: txHash,
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ECDSA_SHA_256',
    });

    const response = await this.kms.send(command);
    return Buffer.from(response.Signature);
    // Private key never leaves AWS KMS
  }
}
```

### Development vs Production

```typescript
// Use different strategies per environment
if (process.env.NODE_ENV === 'production') {
  // Use KMS or Vault — private key never in memory
} else {
  // Local dev: use test wallet from env var
  // NEVER commit this env var
}
```
