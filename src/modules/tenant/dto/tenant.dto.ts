import { IsString, IsEnum, IsOptional, IsObject, MinLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantPlan } from '../entities/tenant.entity';

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'acme-corp', description: 'URL-safe unique identifier' })
  @IsString()
  @MinLength(2)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug: string;

  @ApiPropertyOptional({ enum: TenantPlan, default: TenantPlan.FREE })
  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @ApiPropertyOptional({ example: { maxUsers: 10, maxStorage: 1024 } })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: TenantPlan })
  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}
