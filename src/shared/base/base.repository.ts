import {
  Repository,
  FindOptionsWhere,
  FindManyOptions,
  EntityManager,
  DeepPartial,
  SelectQueryBuilder,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { FindAllResult } from './base.dto';
import { PaginationDto } from './pagination.dto';
import { NotFoundException } from '@nestjs/common';

export abstract class BaseRepository<T extends BaseEntity> {
  constructor(protected readonly repo: Repository<T>) {}

  get manager(): EntityManager {
    return this.repo.manager;
  }

  async create(data: DeepPartial<T>, manager?: EntityManager): Promise<T> {
    const r = manager ? manager.getRepository(this.repo.target) : this.repo;
    const entity = r.create(data);
    return r.save(entity as any);
  }

  async createMany(data: DeepPartial<T>[], manager?: EntityManager): Promise<T[]> {
    const r = manager ? manager.getRepository(this.repo.target) : this.repo;
    const entities = data.map((d) => r.create(d));
    return r.save(entities as any);
  }

  async findAll(
    params: PaginationDto,
    where?: FindOptionsWhere<T>,
    relations?: string[],
  ): Promise<FindAllResult<T>> {
    const { page = 1, size = 10, sortBy = 'createdAt', sortOrder = 'DESC' } = params;

    const [data, totalElements] = await this.repo.findAndCount({
      where: { ...(where || {}), isActive: true } as any,
      relations,
      order: { [sortBy]: sortOrder } as any,
      skip: (page - 1) * size,
      take: size,
    });

    return {
      data,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      page,
      size,
    };
  }

  async findById(id: string, relations?: string[]): Promise<T> {
    const entity = await this.repo.findOne({
      where: { id, isActive: true } as any,
      relations,
    });
    if (!entity) throw new NotFoundException(`Resource with id ${id} not found`);
    return entity;
  }

  async findOne(where: FindOptionsWhere<T>, relations?: string[]): Promise<T | null> {
    return this.repo.findOne({ where, relations });
  }

  async update(id: string, data: DeepPartial<T>, manager?: EntityManager): Promise<T> {
    const r = manager ? manager.getRepository(this.repo.target) : this.repo;
    await r.update(id, data as any);
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  async hardDelete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  async restore(id: string): Promise<void> {
    await this.repo.restore(id);
  }

  async count(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repo.count({ where });
  }

  async exists(where: FindOptionsWhere<T>): Promise<boolean> {
    const count = await this.repo.count({ where });
    return count > 0;
  }

  createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repo.createQueryBuilder(alias);
  }

  async transaction<R>(operation: (manager: EntityManager) => Promise<R>): Promise<R> {
    return this.repo.manager.transaction(operation);
  }
}
