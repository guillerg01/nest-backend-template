import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:4200'];

function buildOriginList(): string[] {
  const frontendUrl = process.env.FRONTEND_URL;
  const extra = process.env.CORS_ORIGINS; // comma-separated extra origins
  const origins = [...DEV_ORIGINS];
  if (frontendUrl) origins.push(frontendUrl);
  if (extra) origins.push(...extra.split(',').map((o) => o.trim()));
  return [...new Set(origins)];
}

export const corsConfig: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    const allowed = buildOriginList();
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-correlation-id',
    'x-seed-secret',
  ],
  credentials: true,
};
