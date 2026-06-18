import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ProductEntity, ProductStatus } from '../entities/product.entity';
import { FindAllResult } from '../../../shared/base/base.dto';
import { PaginationDto } from '../../../shared/base/pagination.dto';

@Injectable()
export class ProductRepository extends BaseRepository<ProductEntity> {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {
    super(productRepo);
  }

  async findBySlug(slug: string): Promise<ProductEntity | null> {
    return this.productRepo.findOne({ where: { slug, isActive: true } });
  }

  async findActive(params: PaginationDto): Promise<FindAllResult<ProductEntity>> {
    return this.findAll(params, { status: ProductStatus.ACTIVE, isActive: true });
  }

  async findByOwner(
    ownerId: string,
    params: PaginationDto,
  ): Promise<FindAllResult<ProductEntity>> {
    return this.findAll(params, { ownerId, isActive: true });
  }

  async search(query: string, limit = 10): Promise<ProductEntity[]> {
    return this.productRepo
      .createQueryBuilder('p')
      .where('p.isActive = true')
      .andWhere('p.status = :status', { status: ProductStatus.ACTIVE })
      .andWhere(
        '(LOWER(p.name) LIKE :q OR LOWER(p.description) LIKE :q)',
        { q: `%${query.toLowerCase()}%` },
      )
      .take(limit)
      .getMany();
  }

  async decrementStock(productId: string, quantity: number): Promise<void> {
    await this.productRepo
      .createQueryBuilder()
      .update()
      .set({ stockQuantity: () => `stock_quantity - ${quantity}` })
      .where('id = :id AND stock_quantity >= :quantity', { id: productId, quantity })
      .execute();
  }

  async incrementViewCount(productId: string): Promise<void> {
    await this.productRepo.increment({ id: productId }, 'viewCount', 1);
  }
}
