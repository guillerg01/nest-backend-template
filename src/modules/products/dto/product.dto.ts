import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BaseDto } from '../../../shared/base/base.dto';
import { ProductStatus } from '../entities/product.entity';

export class ProductDto extends BaseDto {
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ required: false }) description: string;
  @ApiProperty() price: number;
  @ApiProperty({ required: false }) compareAtPrice: number;
  @ApiProperty() stockQuantity: number;
  @ApiProperty({ enum: ProductStatus }) status: ProductStatus;
  @ApiProperty({ required: false }) imageUrl: string;
  @ApiProperty({ required: false }) discountPercent: number;
  @ApiProperty() isInStock: boolean;

  fromEntity(entity: any): this {
    super.fromEntity(entity);
    this.name = entity?.name;
    this.slug = entity?.slug;
    this.description = entity?.description;
    this.price = Number(entity?.price);
    this.compareAtPrice = entity?.compareAtPrice ? Number(entity.compareAtPrice) : null;
    this.stockQuantity = entity?.stockQuantity;
    this.status = entity?.status;
    this.imageUrl = entity?.imageUrl;
    this.discountPercent = entity?.discountPercent;
    this.isInStock = entity?.isInStock;
    return this;
  }
}

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones Pro' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Best noise-cancelling headphones' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 199.99 })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price: number;

  @ApiProperty({ example: 249.99, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  compareAtPrice?: number;

  @ApiProperty({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiProperty({ enum: ProductStatus, required: false })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;
}

export class UpdateProductDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) price?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) stockQuantity?: number;
  @ApiProperty({ enum: ProductStatus, required: false }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsUrl() imageUrl?: string;
}
