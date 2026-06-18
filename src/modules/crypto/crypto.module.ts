import { Module } from '@nestjs/common';
import { WalletService } from './services/wallet.service';
import { BlockchainService } from './services/blockchain.service';
import { CryptoController } from './crypto.controller';

@Module({
  providers: [WalletService, BlockchainService],
  controllers: [CryptoController],
  exports: [WalletService, BlockchainService],
})
export class CryptoModule {}
