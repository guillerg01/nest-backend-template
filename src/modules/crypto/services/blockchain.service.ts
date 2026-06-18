import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Generic blockchain query service using public RPC endpoints.
 * No private key operations — read-only blockchain data.
 * For write operations (transactions), see README.md → ethers.js / viem sections.
 */
@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  constructor(private readonly config: ConfigService) {}

  // ─── EVM JSON-RPC (Ethereum/Polygon/BSC/Arbitrum) ─────────────────────────

  private async evmRpc(method: string, params: any[], rpcUrl?: string): Promise<any> {
    const url = rpcUrl || this.config.get('EVM_RPC_URL') || 'https://eth.llamarpc.com';

    const response = await axios.post(url, {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });

    if (response.data.error) {
      throw new Error(`RPC error: ${JSON.stringify(response.data.error)}`);
    }

    return response.data.result;
  }

  async getEvmBalance(address: string, rpcUrl?: string): Promise<{ wei: string; eth: string }> {
    const wei = await this.evmRpc('eth_getBalance', [address, 'latest'], rpcUrl);
    const weiDecimal = BigInt(wei);
    const ethValue = (Number(weiDecimal) / 1e18).toFixed(6);
    return { wei: weiDecimal.toString(), eth: ethValue };
  }

  async getEvmBlockNumber(rpcUrl?: string): Promise<number> {
    const hex = await this.evmRpc('eth_blockNumber', [], rpcUrl);
    return parseInt(hex, 16);
  }

  async getEvmTransaction(txHash: string, rpcUrl?: string): Promise<any> {
    return this.evmRpc('eth_getTransactionByHash', [txHash], rpcUrl);
  }

  async getEvmTransactionReceipt(txHash: string, rpcUrl?: string): Promise<any> {
    return this.evmRpc('eth_getTransactionReceipt', [txHash], rpcUrl);
  }

  async getEvmTokenBalance(
    contractAddress: string,
    walletAddress: string,
    rpcUrl?: string,
  ): Promise<string> {
    // ERC-20 balanceOf(address) selector = 0x70a08231
    const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
    const result = await this.evmRpc('eth_call', [{ to: contractAddress, data }, 'latest'], rpcUrl);
    return BigInt(result).toString();
  }

  // ─── Price Data (via CoinGecko public API) ────────────────────────────────

  async getCryptoPrice(
    coinId: string,
    currency = 'usd',
  ): Promise<{ price: number; change24h: number }> {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: {
          ids: coinId,
          vs_currencies: currency,
          include_24hr_change: true,
        },
      },
    );

    const data = response.data[coinId];
    return {
      price: data[currency],
      change24h: data[`${currency}_24h_change`],
    };
  }

  async getMultipleTokenPrices(
    coinIds: string[],
    currency = 'usd',
  ): Promise<Record<string, { price: number; change24h: number }>> {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: {
          ids: coinIds.join(','),
          vs_currencies: currency,
          include_24hr_change: true,
        },
      },
    );

    const result: Record<string, { price: number; change24h: number }> = {};
    for (const id of coinIds) {
      const data = response.data[id];
      if (data) {
        result[id] = { price: data[currency], change24h: data[`${currency}_24h_change`] };
      }
    }
    return result;
  }

  // ─── Solana (via public JSON-RPC) ─────────────────────────────────────────

  private async solanaRpc(method: string, params: any[]): Promise<any> {
    const url = this.config.get('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    const response = await axios.post(url, { jsonrpc: '2.0', id: 1, method, params });
    if (response.data.error) throw new Error(`Solana RPC: ${JSON.stringify(response.data.error)}`);
    return response.data.result;
  }

  async getSolanaBalance(address: string): Promise<{ lamports: number; sol: number }> {
    const result = await this.solanaRpc('getBalance', [address]);
    return {
      lamports: result.value,
      sol: result.value / 1e9,
    };
  }

  // ─── Transaction Monitoring ───────────────────────────────────────────────

  async waitForEvmTransaction(
    txHash: string,
    options: { timeoutMs?: number; intervalMs?: number; rpcUrl?: string } = {},
  ): Promise<any> {
    const { timeoutMs = 60000, intervalMs = 3000, rpcUrl } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await this.getEvmTransactionReceipt(txHash, rpcUrl);
      if (receipt) return receipt;
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`Transaction ${txHash} not confirmed after ${timeoutMs}ms`);
  }
}
