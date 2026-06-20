import { NotFoundException } from '@nestjs/common';
import { BaseEntity } from './base.entity';
import { BaseDto, FindAllResult } from './base.dto';
import { BaseRepository } from './base.repository';
import { PaginationDto } from './pagination.dto';
import { DeepPartial } from 'typeorm';

export abstract class CrudService<
  TEntity extends BaseEntity,
  TDto extends BaseDto,
  TRepo extends BaseRepository<TEntity>,
> {
  constructor(
    protected readonly repo: TRepo,
    private readonly DtoClass: new () => TDto,
  ) {}

  protected toDto(entity: TEntity): TDto {
    return new this.DtoClass().fromEntity(entity) as TDto;
  }

  protected toDtoList(entities: TEntity[]): TDto[] {
    return entities.map((e) => this.toDto(e));
  }

  async findAll(params: PaginationDto): Promise<FindAllResult<TDto>> {
    const result = await this.repo.findAll(params);
    return {
      ...result,
      data: this.toDtoList(result.data),
    };
  }

  async findById(id: string): Promise<TDto> {
    const entity = await this.repo.findById(id);
    return this.toDto(entity);
  }

  async create(data: DeepPartial<TEntity>): Promise<TDto> {
    const entity = await this.repo.create(data);
    return this.toDto(entity);
  }

  async update(id: string, data: DeepPartial<TEntity>): Promise<TDto> {
    const entity = await this.repo.update(id, data);
    return this.toDto(entity);
  }

  async remove(id: string): Promise<{ message: string }> {
    await this.repo.findById(id);
    await this.repo.softDelete(id);
    return { message: `Resource ${id} deleted` };
  }
}
