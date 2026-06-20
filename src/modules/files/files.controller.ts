import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { S3Service } from './services/s3.service';
import { Permissions } from '../../shared/decorators/permissions.decorator';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly s3Service: S3Service) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload single file to S3' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_, file, cb) => {
        if (!file) return cb(new BadRequestException('No file provided'), false);
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          return cb(new BadRequestException(`File type not allowed: ${file.mimetype}`), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File, @Query('folder') folder = 'uploads') {
    if (!file) throw new BadRequestException('File is required');
    return this.s3Service.uploadMulter(file, folder);
  }

  @Post('upload/many')
  @ApiOperation({ summary: 'Upload multiple files to S3' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_SIZE } }))
  async uploadMany(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('folder') folder = 'uploads',
  ) {
    const results = await Promise.all(files.map((f) => this.s3Service.uploadMulter(f, folder)));
    return { uploaded: results.length, files: results };
  }

  @Get(':key/url')
  @ApiOperation({ summary: 'Get presigned download URL for a file' })
  getPresignedUrl(
    @Param('key') key: string,
    @Query('expiresIn') expiresIn = 3600,
  ) {
    return this.s3Service.getPresignedUrl(decodeURIComponent(key), Number(expiresIn));
  }

  @Get()
  @Permissions('files:read')
  @ApiOperation({ summary: 'List files in a folder' })
  list(@Query('prefix') prefix = 'uploads/') {
    return this.s3Service.list(prefix);
  }

  @Delete(':key')
  @Permissions('files:delete')
  @ApiOperation({ summary: 'Delete file from S3' })
  delete(@Param('key') key: string) {
    return this.s3Service.delete(decodeURIComponent(key));
  }
}
