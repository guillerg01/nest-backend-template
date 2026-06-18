import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { S3Service } from './services/s3.service';
import { FilesController } from './files.controller';

@Module({
  imports: [MulterModule.register()],
  providers: [S3Service],
  controllers: [FilesController],
  exports: [S3Service],
})
export class FilesModule {}
