# Files Module

S3, local storage, Cloudinary, DigitalOcean Spaces, Backblaze B2, MinIO, image processing, validation, and CDN setup.

---

## Table of Contents

1. [AWS S3 (current)](#aws-s3)
2. [Presigned URLs vs Server Upload](#presigned-urls-vs-server-upload)
3. [Local Disk Storage](#local-disk-storage)
4. [Cloudinary](#cloudinary)
5. [DigitalOcean Spaces](#digitalocean-spaces)
6. [Backblaze B2](#backblaze-b2)
7. [MinIO (Self-Hosted)](#minio)
8. [File Validation](#file-validation)
9. [Image Processing with Sharp](#image-processing)
10. [CDN Setup (CloudFront)](#cdn-setup)
11. [Storing File Metadata in DB](#file-metadata)

---

## AWS S3

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```typescript
// files.service.ts
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';

@Injectable()
export class FilesService {
  private s3: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.configService.get('AWS_S3_BUCKET');
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = 'uploads',
  ): Promise<{ url: string; key: string }> {
    const ext = file.originalname.split('.').pop();
    const key = `${folder}/${uuid()}.${ext}`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: 'inline',
      // For private files: do not set ACL, use presigned URLs
      // For public files:
      // ACL: 'public-read',
    }));

    const url = `https://${this.bucket}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${key}`;
    return { url, key };
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  // Generate presigned URL for temporary access to private files
  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  // Generate presigned URL for client-side direct upload to S3
  async getPresignedUploadUrl(
    folder: string,
    contentType: string,
    maxSizeBytes: number,
  ): Promise<{ uploadUrl: string; key: string; fileUrl: string }> {
    const ext = contentType.split('/')[1];
    const key = `${folder}/${uuid()}.${ext}`;

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // Enforce max file size via conditions
      }),
      { expiresIn: 300 }, // 5 minutes to complete upload
    );

    const fileUrl = `https://${this.bucket}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${key}`;
    return { uploadUrl, key, fileUrl };
  }
}
```

### Environment Variables

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=my-app-files
```

---

## Presigned URLs vs Server Upload

### Server Upload (proxy through API)

```
Client ──upload──► Your API ──stream──► S3
```

**Pros:** full control, validate before upload, virus scan, transform
**Cons:** your server handles file data (bandwidth, memory, CPU), slower

**Use when:** need server-side validation, transformation, virus scanning before storage.

### Direct Client Upload (presigned URL)

```
Client ──request presigned URL──► Your API (tiny request)
Client ──PUT file directly──► S3 (bypasses your server entirely)
Client ──notify completed──► Your API (save metadata)
```

**Pros:** your server never touches file bytes (saves bandwidth + memory), faster for large files, S3 enforces size limit
**Cons:** less control, ClamAV scanning needs a trigger (S3 Lambda function)

**Use when:** large files, media uploads, user-generated content at scale.

```typescript
// Controller for presigned upload flow
@Post('upload-url')
async getUploadUrl(
  @Body() dto: GetUploadUrlDto,
  @CurrentUser() user: User,
) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
  if (!allowed.includes(dto.contentType)) {
    throw new BadRequestException('File type not allowed');
  }

  return this.filesService.getPresignedUploadUrl(
    `users/${user.id}`,
    dto.contentType,
    10 * 1024 * 1024, // 10MB max
  );
}

// After client uploads directly to S3, client notifies server
@Post('confirm-upload')
async confirmUpload(
  @Body() dto: ConfirmUploadDto,
  @CurrentUser() user: User,
) {
  // Save metadata to DB
  return this.filesService.saveFileMetadata({
    key: dto.key,
    url: dto.fileUrl,
    userId: user.id,
    size: dto.size,
    mimeType: dto.contentType,
  });
}
```

---

## Local Disk Storage

For development or small self-hosted apps. Not suitable for multi-instance production deployments.

```typescript
// local-files.service.ts
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

export const multerDiskConfig: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = './uploads';
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuid()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
};

// Controller
@Post('upload')
@UseInterceptors(FileInterceptor('file', multerDiskConfig))
async uploadLocal(@UploadedFile() file: Express.Multer.File) {
  return {
    url: `/uploads/${file.filename}`,
    key: file.filename,
  };
}
```

Serve files statically:

```typescript
// main.ts
app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });
```

**Warning:** Local storage breaks horizontally scaled deployments — files are on one instance's disk. Use a shared volume (NFS) or switch to S3.

---

## Cloudinary

Best for image-heavy apps. Auto-optimization, transformations, and CDN are built in.

```bash
npm install cloudinary
```

```typescript
// cloudinary.service.ts
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService implements OnModuleInit {
  onModuleInit() {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    folder = 'uploads',
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          transformation: [
            { width: 2000, height: 2000, crop: 'limit' }, // max dimensions
            { quality: 'auto:good' },                      // auto-optimize quality
            { fetch_format: 'auto' },                      // auto WebP/AVIF
          ],
        },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        },
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });
  }

  async deleteFile(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }

  // Transform on the fly via URL parameters
  getTransformedUrl(publicId: string, options: {
    width?: number;
    height?: number;
    crop?: string;
    quality?: number;
  }): string {
    return cloudinary.url(publicId, {
      transformation: [options],
      secure: true,
    });
  }
}
```

```typescript
// Usage: get a 300x300 thumbnail
const thumbUrl = cloudinaryService.getTransformedUrl('uploads/myimage', {
  width: 300,
  height: 300,
  crop: 'fill',
});
```

**Docs:** [cloudinary.com/documentation/node_integration](https://cloudinary.com/documentation/node_integration)

---

## DigitalOcean Spaces

S3-compatible API. Reuse the S3 service with a different endpoint.

```typescript
// spaces.service.ts
import { S3Client } from '@aws-sdk/client-s3';

// DigitalOcean Spaces uses S3-compatible API with custom endpoint
const spacesClient = new S3Client({
  endpoint: 'https://nyc3.digitaloceanspaces.com', // your region
  region: 'nyc3',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  forcePathStyle: false, // Spaces uses virtual hosted-style
});

// All other S3 operations work identically
```

**CDN:** DigitalOcean Spaces has a built-in CDN at `https://your-bucket.nyc3.cdn.digitaloceanspaces.com` — just enable it in the dashboard.

---

## Backblaze B2

Cheapest S3-compatible storage (~$6/TB vs AWS S3 at ~$23/TB).

```typescript
const b2Client = new S3Client({
  endpoint: 'https://s3.us-west-004.backblazeb2.com', // your region endpoint
  region: 'us-west-004',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});
```

**Gotcha:** B2 free egress only with Cloudflare CDN. Set up a Cloudflare R2 or Cloudflare CDN in front of B2 for free egress.

---

## MinIO (Self-Hosted)

S3-compatible, runs in Docker. Perfect for on-premise or air-gapped environments.

```yaml
# docker-compose.yml
services:
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001" # web UI
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
```

```typescript
const minioClient = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1', // any value works
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  forcePathStyle: true, // REQUIRED for MinIO
});
```

---

## File Validation

### MIME Type Checking

```typescript
// Checking file extension is NOT enough — files can be renamed.
// Check actual file signature (magic bytes).
import * as fileType from 'file-type'; // npm install file-type

async validateFile(buffer: Buffer, allowedTypes: string[]): Promise<void> {
  const detected = await fileType.fromBuffer(buffer);

  if (!detected) {
    throw new BadRequestException('Cannot determine file type');
  }

  if (!allowedTypes.includes(detected.mime)) {
    throw new BadRequestException(
      `File type ${detected.mime} not allowed. Allowed: ${allowedTypes.join(', ')}`
    );
  }
}
```

### File Size Limits

```typescript
// Multer configuration
export const multerConfig: MulterOptions = {
  storage: memoryStorage(), // store in memory for processing
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5,                    // max 5 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException(`${file.mimetype} not allowed`), false);
    }
  },
};
```

### Antivirus Scanning (ClamAV)

For user-generated content at scale, scan files for malware before storage.

```bash
npm install clamscan
# Requires ClamAV daemon running: apt install clamav clamav-daemon
```

```typescript
import NodeClam from 'clamscan';

@Injectable()
export class AntivirusService implements OnModuleInit {
  private clam: NodeClam;

  async onModuleInit() {
    this.clam = await new NodeClam().init({
      clamdscan: {
        host: process.env.CLAMAV_HOST ?? '127.0.0.1',
        port: 3310,
      },
    });
  }

  async scanBuffer(buffer: Buffer): Promise<boolean> {
    const { isInfected } = await this.clam.scanBuffer(buffer);
    return !isInfected;
  }
}
```

---

## Image Processing

Resize, compress, and convert images with sharp.

```bash
npm install sharp
```

```typescript
// image-processor.service.ts
import * as sharp from 'sharp';

@Injectable()
export class ImageProcessorService {
  // Generate multiple sizes (avatar use case)
  async processAvatar(buffer: Buffer): Promise<{
    original: Buffer;
    thumbnail: Buffer;
    small: Buffer;
  }> {
    const [original, thumbnail, small] = await Promise.all([
      sharp(buffer)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer(),

      sharp(buffer)
        .resize(100, 100, { fit: 'cover', position: 'centre' })
        .webp({ quality: 80 })
        .toBuffer(),

      sharp(buffer)
        .resize(40, 40, { fit: 'cover', position: 'centre' })
        .webp({ quality: 75 })
        .toBuffer(),
    ]);

    return { original, thumbnail, small };
  }

  // Optimize a general image upload
  async optimizeImage(
    buffer: Buffer,
    maxWidth = 1920,
    quality = 85,
  ): Promise<Buffer> {
    return sharp(buffer)
      .resize(maxWidth, undefined, {
        fit: 'inside',
        withoutEnlargement: true, // don't upscale small images
      })
      .webp({ quality })
      .toBuffer();
  }

  async getMetadata(buffer: Buffer): Promise<sharp.Metadata> {
    return sharp(buffer).metadata();
  }
}
```

---

## CDN Setup

### CloudFront in Front of S3

Instead of `https://bucket.s3.amazonaws.com/key`, serve from `https://cdn.myapp.com/key`.

1. Create CloudFront distribution
2. Origin: `bucket.s3.amazonaws.com`
3. Set `Origin Access Control` (OAC) — allows CloudFront to access private S3
4. Add CNAME: `cdn.myapp.com → d123.cloudfront.net`

```typescript
// Return CDN URL instead of S3 URL
getFileUrl(key: string): string {
  const cdnDomain = this.configService.get('CDN_DOMAIN');
  if (cdnDomain) {
    return `https://${cdnDomain}/${key}`;
  }
  return `https://${this.bucket}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${key}`;
}
```

**Benefits:** global edge caching, DDoS protection, automatic gzip/Brotli, custom domain with SSL.

---

## File Metadata

Always store file metadata in your DB — never rely solely on S3 for file management.

```typescript
@Entity('files')
export class FileRecord extends BaseEntity {
  @Column()
  key: string; // S3 key — use this for deletes and presigned URLs

  @Column()
  url: string; // CDN or S3 public URL

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @Column('integer')
  size: number; // bytes

  @Column({ nullable: true })
  userId: string; // who uploaded

  @Column({ default: 'private' }) // 'public' | 'private'
  visibility: string;

  @Column({ nullable: true })
  entityType: string; // 'user-avatar', 'product-image', 'document'

  @Column({ nullable: true })
  entityId: string; // ID of the entity this file belongs to
}
```

### What to Store

| Field | Why |
|---|---|
| `key` | To delete from S3 — URL alone isn't enough if CDN domain changes |
| `url` | For serving, avoiding re-generating each time |
| `size` | Quota enforcement, display to users |
| `mimeType` | Content-Type header, client rendering decisions |
| `userId` | Ownership, cleanup on account deletion |
| `entityType/Id` | To find files by their parent entity |
