import { NotFoundException } from '@nestjs/common';
import { CrudService } from './crud.service';
import { BaseEntity } from './base.entity';
import { BaseDto, FindAllResult } from './base.dto';
import { BaseRepository } from './base.repository';

class ItemEntity extends BaseEntity {
  name: string;
}

class ItemDto extends BaseDto {
  name: string;
  fromEntity(entity: any): this {
    super.fromEntity(entity);
    this.name = entity?.name;
    return this;
  }
}

class MockItemRepository extends BaseRepository<ItemEntity> {
  constructor() { super(null as any); }
}

class ItemsService extends CrudService<ItemEntity, ItemDto, MockItemRepository> {
  constructor(repo: MockItemRepository) { super(repo, ItemDto); }
  // expose protected for test
  toDto(e: ItemEntity): ItemDto { return super.toDto(e); }
  toDtoList(entities: ItemEntity[]): ItemDto[] { return super.toDtoList(entities); }
}

const makeEntity = (overrides = {}): ItemEntity =>
  ({ id: 'uuid-1', name: 'Test Item', isActive: true, createdAt: new Date(), updatedAt: new Date(), ...overrides } as ItemEntity);

describe('CrudService', () => {
  let service: ItemsService;
  let repo: jest.Mocked<MockItemRepository>;

  beforeEach(() => {
    repo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as any;
    service = new ItemsService(repo);
  });

  describe('findAll', () => {
    it('returns paginated DTOs', async () => {
      const entities = [makeEntity(), makeEntity({ id: 'uuid-2', name: 'B' })];
      const findResult: FindAllResult<ItemEntity> = {
        data: entities, totalElements: 2, totalPages: 1, page: 1, size: 10,
      };
      repo.findAll.mockResolvedValue(findResult);

      const result = await service.findAll({ page: 1, size: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toBeInstanceOf(ItemDto);
      expect(result.data[0].name).toBe('Test Item');
      expect(result.totalElements).toBe(2);
    });
  });

  describe('findById', () => {
    it('returns DTO when entity found', async () => {
      repo.findById.mockResolvedValue(makeEntity());

      const result = await service.findById('uuid-1');

      expect(result).toBeInstanceOf(ItemDto);
      expect(result.id).toBe('uuid-1');
      expect(result.name).toBe('Test Item');
    });
  });

  describe('create', () => {
    it('creates and returns DTO', async () => {
      const entity = makeEntity();
      repo.create.mockResolvedValue(entity);

      const result = await service.create({ name: 'Test Item' } as any);

      expect(repo.create).toHaveBeenCalledWith({ name: 'Test Item' });
      expect(result).toBeInstanceOf(ItemDto);
    });
  });

  describe('update', () => {
    it('updates and returns DTO', async () => {
      const updated = makeEntity({ name: 'Updated' });
      repo.findById.mockResolvedValue(makeEntity());
      repo.update.mockResolvedValue(updated);

      const result = await service.update('uuid-1', { name: 'Updated' } as any);

      expect(result.name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('soft deletes and returns message', async () => {
      repo.findById.mockResolvedValue(makeEntity());
      repo.softDelete.mockResolvedValue(undefined);

      const result = await service.remove('uuid-1');

      expect(repo.softDelete).toHaveBeenCalledWith('uuid-1');
      expect(result.message).toContain('uuid-1');
    });
  });

  describe('toDto', () => {
    it('maps entity to DTO correctly', () => {
      const entity = makeEntity({ name: 'My Product' });
      const dto = service.toDto(entity);

      expect(dto.id).toBe('uuid-1');
      expect(dto.name).toBe('My Product');
      expect(dto.isActive).toBe(true);
    });

    it('handles null entity gracefully', () => {
      const dto = service.toDto(null as any);
      expect(dto.name).toBeUndefined();
    });
  });
});
