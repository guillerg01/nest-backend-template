import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const sharedOptions: Partial<DataSourceOptions> = {
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: process.env.DB_SYNC === 'true',
  migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  logging: !isProduction,
  extra: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 60000,
    query_timeout: 60000,
  },
};

export const databaseConfig = (): DataSourceOptions => {
  // Render / Railway / Heroku inject a single DATABASE_URL connection string
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return {
      type: 'postgres',
      url: databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      ...sharedOptions,
    } as DataSourceOptions;
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'nest_template',
    ...sharedOptions,
  } as DataSourceOptions;
};

// Standalone DataSource for CLI migrations
export default new DataSource(databaseConfig());
