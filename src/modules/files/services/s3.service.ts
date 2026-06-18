import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as path from 'path';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
  size: number;
  contentType: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.client = new S3Client({
      region: config.get('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.get('AWS_S3_BUCKET', 'my-app-bucket');
  }

  // ─── Upload ───────────────────────────────────────────────────────────────

  async upload(
    file: Buffer | string,
    filename: string,
    options: {
      contentType?: string;
      folder?: string;
      isPublic?: boolean;
      metadata?: Record<string, string>;
    } = {},
  ): Promise<UploadResult> {
    const { contentType = 'application/octet-stream', folder = 'uploads', isPublic = false, metadata } = options;

    const ext = path.extname(filename);
    const hash = crypto.randomBytes(8).toString('hex');
    const key = `${folder}/${hash}${ext}`;
    const body = typeof file === 'string' ? Buffer.from(file) : file;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: isPublic ? 'public-read' : 'private',
        Metadata: metadata,
      }),
    );

    const url = isPublic
      ? `https://${this.bucket}.s3.amazonaws.com/${key}`
      : await this.getPresignedUrl(key);

    this.logger.log(`Uploaded: ${key} (${body.length} bytes)`);
    return { key, url, bucket: this.bucket, size: body.length, contentType };
  }

  async uploadMulter(file: Express.Multer.File, folder = 'uploads'): Promise<UploadResult> {
    return this.upload(file.buffer, file.originalname, {
      contentType: file.mimetype,
      folder,
    });
  }

  // ─── Presigned URLs ───────────────────────────────────────────────────────

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 3600,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted: ${key}`);
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(prefix = '', maxKeys = 100): Promise<{ key: string; size: number; lastModified: Date }[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: maxKeys }),
    );

    return (response.Contents ?? []).map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
    }));
  }

  // ─── Extract key from URL ────────────────────────────────────────────────

  extractKeyFromUrl(url: string): string {
    const base = `https://${this.bucket}.s3.amazonaws.com/`;
    return url.startsWith(base) ? url.replace(base, '') : url;
  }
}
