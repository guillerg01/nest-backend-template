import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductRepository } from './repositories/product.repository';
import { ProductEntity, ProductStatus } from './entities/product.entity';
import { CreateProductDto } from './dto/product.dto';

jest.mock('slugify', () => ({
  __esModule: true,
  default: jest.fn((_name: string) => 'test-product'),
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'abc123'),
}));

const makeProduct = (overrides: Partial<ProductEntity> = {}): ProductEntity =>
  ({
    id: 'prod-uuid',
    name: 'Test Product',
    slug: 'test-product',
    price: 99.99,
    status: ProductStatus.ACTIVE,
    stockQuantity: 10,
    isActive: true,
    ownerId: 'user-uuid',
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductEntity);

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: jest.Mocked<ProductRepository>;

  beforeEach(() => {
    productRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findBySlug: jest.fn(),
      findActive: jest.fn(),
      findByOwner: jest.fn(),
      search: jest.fn(),
      incrementViewCount: jest.fn(),
      decrementStock: jest.fn(),
    } as any;

    service = new ProductsService(productRepo);
  });

  describe('createProduct', () => {
    it('generates slug from name and creates product', async () => {
      const dto: CreateProductDto = {
        name: 'Test Product',
        price: 99.99,
        stockQuantity: 10,
      } as any;
      const product = makeProduct();
      productRepo.findBySlug.mockResolvedValue(null); // slug available
      productRepo.create.mockResolvedValue(product);

      const result = await service.createProduct(dto, 'user-uuid');

      expect(productRepo.findBySlug).toHaveBeenCalledWith('test-product');
      expect(productRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'test-product', ownerId: 'user-uuid' }),
      );
      expect(result).toBeDefined();
    });

    it('appends nanoid suffix when slug already exists', async () => {
      const dto: CreateProductDto = { name: 'Test Product', price: 99.99 } as any;
      productRepo.findBySlug.mockResolvedValueOnce(makeProduct()); // slug taken
      productRepo.create.mockResolvedValue(makeProduct({ slug: 'test-product-abc123' }));

      await service.createProduct(dto, 'user-uuid');

      expect(productRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'test-product-abc123' }),
      );
    });
  });

  describe('findBySlug', () => {
    it('increments viewCount and returns DTO', async () => {
      const product = makeProduct();
      productRepo.findBySlug.mockResolvedValue(product);
      productRepo.incrementViewCount.mockResolvedValue(undefined);

      const result = await service.findBySlug('test-product');

      expect(productRepo.incrementViewCount).toHaveBeenCalledWith('prod-uuid');
      expect(result.slug).toBe('test-product');
    });

    it('throws BadRequestException when not found', async () => {
      productRepo.findBySlug.mockResolvedValue(null);

      await expect(service.findBySlug('not-exist')).rejects.toThrow(BadRequestException);
    });
  });

  describe('search', () => {
    it('returns array of DTOs', async () => {
      const products = [makeProduct(), makeProduct({ id: 'prod-2', name: 'Another' })];
      productRepo.search.mockResolvedValue(products);

      const result = await service.search('test');

      expect(result).toHaveLength(2);
      expect(productRepo.search).toHaveBeenCalledWith('test');
    });
  });

  describe('findActive', () => {
    it('maps entities to DTOs', async () => {
      const products = [makeProduct()];
      productRepo.findActive.mockResolvedValue({
        data: products,
        totalElements: 1,
        totalPages: 1,
        page: 1,
        size: 10,
      });

      const result = await service.findActive({ page: 1, size: 10 });

      expect(result.totalElements).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });
});
