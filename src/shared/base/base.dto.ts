import { ApiProperty } from '@nestjs/swagger';

export class BaseDto {
  @ApiProperty({ description: 'UUID identifier' })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ required: false })
  deletedAt?: Date;

  @ApiProperty()
  isActive: boolean;

  fromEntity(entity: any): this {
    if (!entity) return this;
    this.id = entity.id;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
    this.deletedAt = entity.deletedAt;
    this.isActive = entity.isActive;
    return this;
  }
}

export interface FindAllResult<T> {
  data: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}
