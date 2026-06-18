import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletService } from './services/wallet.service';
import { BlockchainService } from './services/blockchain.service';

class EncryptDto {
  @ApiProperty()
  @IsString()
  plaintext: string;

  @ApiProperty({ description: '64-char hex key (32 bytes). Use generateKey endpoint to get one.' })
  @IsString()
  keyHex: string;
}

class HmacDto {
  @ApiProperty()
  @IsString()
  data: string;

  @ApiProperty()
  @IsString()
  secret: string;
}

@ApiTags('Crypto / Blockchain')
@ApiBearerAuth()
@Controller('crypto')
export class CryptoController {
  constructor(
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
  ) {}

  @Get('key/generate')
  @ApiOperation({ summary: 'Generate random AES-256 encryption key' })
  generateKey() {
    return { key: this.walletService.generateEncryptionKey() };
  }

  @Post('encrypt')
  @ApiOperation({ summary: 'Encrypt plaintext with AES-256-GCM' })
  encrypt(@Body() dto: EncryptDto) {
    return this.walletService.encrypt(dto.plaintext, dto.keyHex);
  }

  @Post('hmac')
  @ApiOperation({ summary: 'Generate HMAC-SHA256 signature' })
  hmac(@Body() dto: HmacDto) {
    const signature = this.walletService.hmacSign(dto.data, dto.secret);
    return { signature };
  }

  @Get('price/:coinId')
  @ApiOperation({ summary: 'Get crypto price from CoinGecko (e.g. bitcoin, ethereum)' })
  getPrice(
    @Param('coinId') coinId: string,
    @Query('currency') currency = 'usd',
  ) {
    return this.blockchainService.getCryptoPrice(coinId, currency);
  }

  @Get('evm/balance/:address')
  @ApiOperation({ summary: 'Get EVM wallet balance (ETH/MATIC/BNB)' })
  getEvmBalance(
    @Param('address') address: string,
    @Query('rpcUrl') rpcUrl?: string,
  ) {
    return this.blockchainService.getEvmBalance(address, rpcUrl);
  }

  @Get('evm/tx/:hash')
  @ApiOperation({ summary: 'Get EVM transaction details' })
  getEvmTx(@Param('hash') hash: string) {
    return this.blockchainService.getEvmTransaction(hash);
  }

  @Get('solana/balance/:address')
  @ApiOperation({ summary: 'Get Solana wallet balance' })
  getSolanaBalance(@Param('address') address: string) {
    return this.blockchainService.getSolanaBalance(address);
  }
}
