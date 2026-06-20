import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ────────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE TYPE "user_provider_enum" AS ENUM ('local', 'google')`);
    await queryRunner.query(`CREATE TYPE "product_status_enum" AS ENUM ('draft', 'active', 'archived')`);
    await queryRunner.query(`CREATE TYPE "room_type_enum" AS ENUM ('direct', 'group', 'channel', 'support')`);
    await queryRunner.query(`CREATE TYPE "message_type_enum" AS ENUM ('text', 'image', 'file', 'audio', 'system')`);
    await queryRunner.query(`CREATE TYPE "message_status_enum" AS ENUM ('sent', 'delivered', 'read')`);

    // ── permissions ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id"          uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMP,
        "is_active"   boolean           NOT NULL DEFAULT true,
        "name"        character varying NOT NULL,
        "description" character varying,
        "module"      character varying,
        CONSTRAINT "UQ_permissions_name" UNIQUE ("name"),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )
    `);

    // ── roles ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMP,
        "is_active"   boolean           NOT NULL DEFAULT true,
        "name"        character varying NOT NULL,
        "description" character varying,
        CONSTRAINT "UQ_roles_name" UNIQUE ("name"),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      )
    `);

    // ── role_permissions (join) ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id"       uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "FK_rp_role"       FOREIGN KEY ("role_id")       REFERENCES "roles"("id")       ON DELETE CASCADE,
        CONSTRAINT "FK_rp_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rp_role" ON "role_permissions" ("role_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_rp_permission" ON "role_permissions" ("permission_id")`);

    // ── users ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                       uuid                   NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"               TIMESTAMP              NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP              NOT NULL DEFAULT now(),
        "deleted_at"               TIMESTAMP,
        "is_active"                boolean                NOT NULL DEFAULT true,
        "email"                    character varying      NOT NULL,
        "first_name"               character varying      NOT NULL,
        "last_name"                character varying      NOT NULL,
        "password"                 character varying,
        "avatar_url"               character varying,
        "phone"                    character varying,
        "provider"                 "user_provider_enum"   NOT NULL DEFAULT 'local',
        "provider_id"              character varying,
        "is_email_verified"        boolean                NOT NULL DEFAULT false,
        "email_verification_token" character varying,
        "password_reset_token"     character varying,
        "password_reset_expires"   TIMESTAMP,
        "last_login_at"            TIMESTAMP,
        "role_id"                  uuid,
        "stripe_customer_id"       character varying,
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users"       PRIMARY KEY ("id"),
        CONSTRAINT "FK_users_role"  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL
      )
    `);

    // ── products ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id"               uuid                   NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"       TIMESTAMP              NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP              NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMP,
        "is_active"        boolean                NOT NULL DEFAULT true,
        "name"             character varying      NOT NULL,
        "slug"             character varying      NOT NULL,
        "description"      text,
        "price"            numeric(10,2)          NOT NULL DEFAULT 0,
        "compare_at_price" numeric(10,2),
        "stock_quantity"   integer                NOT NULL DEFAULT 0,
        "status"           "product_status_enum"  NOT NULL DEFAULT 'draft',
        "image_url"        character varying,
        "images"           jsonb,
        "metadata"         jsonb,
        "category_id"      character varying,
        "owner_id"         character varying,
        "view_count"       integer                NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_products_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_products"      PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_products_status_active" ON "products" ("status", "is_active")`);

    // ── chat_rooms ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "chat_rooms" (
        "id"                   uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"           TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP         NOT NULL DEFAULT now(),
        "deleted_at"           TIMESTAMP,
        "is_active"            boolean           NOT NULL DEFAULT true,
        "name"                 character varying,
        "description"          character varying,
        "avatar_url"           character varying,
        "type"                 "room_type_enum"  NOT NULL DEFAULT 'group',
        "is_public"            boolean           NOT NULL DEFAULT false,
        "created_by"           character varying,
        "last_message_at"      TIMESTAMP,
        "last_message_preview" character varying,
        "member_count"         integer           NOT NULL DEFAULT 0,
        CONSTRAINT "PK_chat_rooms" PRIMARY KEY ("id")
      )
    `);

    // ── chat_room_members (join) ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "chat_room_members" (
        "room_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "PK_chat_room_members" PRIMARY KEY ("room_id", "user_id"),
        CONSTRAINT "FK_crm_room" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_crm_user" FOREIGN KEY ("user_id") REFERENCES "users"("id")      ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_crm_room" ON "chat_room_members" ("room_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_crm_user" ON "chat_room_members" ("user_id")`);

    // ── chat_messages ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id"          uuid                   NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"  TIMESTAMP              NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP              NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMP,
        "is_active"   boolean                NOT NULL DEFAULT true,
        "room_id"     character varying      NOT NULL,
        "sender_id"   character varying,
        "content"     text                   NOT NULL,
        "type"        "message_type_enum"    NOT NULL DEFAULT 'text',
        "status"      "message_status_enum"  NOT NULL DEFAULT 'sent',
        "reply_to_id" character varying,
        "metadata"    jsonb,
        "edited_at"   TIMESTAMP,
        "read_by"     jsonb                  NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_chat_messages_room_created" ON "chat_messages" ("room_id", "created_at")`);

    // ── audit_logs ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"           uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"   TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMP         NOT NULL DEFAULT now(),
        "deleted_at"   TIMESTAMP,
        "is_active"    boolean           NOT NULL DEFAULT true,
        "userId"       character varying,
        "userEmail"    character varying,
        "method"       character varying NOT NULL,
        "endpoint"     character varying NOT NULL,
        "ipAddress"    character varying,
        "requestBody"  jsonb,
        "statusCode"   integer,
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_room_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_rooms"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "message_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "message_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "room_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "product_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_provider_enum"`);
  }
}
