import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BaseRepository } from './base.repository';
import { BaseEntity } from './base.entity';

// Minimal concrete entity for testing
class TestEntity extends BaseEntity {
  name: string;
}

// Minimal concrete repository for testing
class TestRepository extends BaseRepository<TestEntity> {
  constructor(repo: Repository<TestEntity>) {
    super(repo);
  }
}

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: { transaction: jest.fn() },
  target: TestEntity,
});

describe('BaseRepository', () => {
  let repo: TestRepository;
  let typeormRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    typeormRepo = mockRepo();
    repo = new TestRepository(typeormRepo as any);
  });

  describe('create', () => {
    it('creates and saves entity', async () => {
      const data = { name: 'Test' };
      const entity = { id: 'uuid-1', name: 'Test', isActive: true };
      typeormRepo.create.mockReturnValue(entity);
      typeormRepo.save.mockResolvedValue(entity);

      const result = await repo.create(data as any);

      expect(typeormRepo.create).toHaveBeenCalledWith(data);
      expect(typeormRepo.save).toHaveBeenCalledWith(entity);
      expect(result).toEqual(entity);
    });
  });

  describe('findAll', () => {
    it('returns paginated result', async () => {
      const entities = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
      typeormRepo.findAndCount.mockResolvedValue([entities, 2]);

      const result = await repo.findAll({ page: 1, size: 10 });

      expect(result).toEqual({
        data: entities,
        totalElements: 2,
        totalPages: 1,
        page: 1,
        size: 10,
      });
    });

    it('calculates totalPages correctly', async () => {
      typeormRepo.findAndCount.mockResolvedValue([[], 25]);

      const result = await repo.findAll({ page: 1, size: 10 });

      expect(result.totalPages).toBe(3); // ceil(25/10)
    });

    it('uses correct skip for page 3', async () => {
      typeormRepo.findAndCount.mockResolvedValue([[], 30]);

      await repo.findAll({ page: 3, size: 10 });

      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('findById', () => {
    it('returns entity when found', async () => {
      const entity = { id: 'uuid-1', name: 'Test', isActive: true };
      typeormRepo.findOne.mockResolvedValue(entity);

      const result = await repo.findById('uuid-1');

      expect(result).toEqual(entity);
      expect(typeormRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'uuid-1', isActive: true } }),
      );
    });

    it('throws NotFoundException when not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      await expect(repo.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('calls softDelete with correct id', async () => {
      typeormRepo.softDelete.mockResolvedValue({ affected: 1 });

      await repo.softDelete('uuid-1');

      expect(typeormRepo.softDelete).toHaveBeenCalledWith('uuid-1');
    });
  });

  describe('exists', () => {
    it('returns true when count > 0', async () => {
      typeormRepo.count.mockResolvedValue(1);
      expect(await repo.exists({ id: 'x' } as any)).toBe(true);
    });

    it('returns false when count === 0', async () => {
      typeormRepo.count.mockResolvedValue(0);
      expect(await repo.exists({ id: 'x' } as any)).toBe(false);
    });
  });
});
