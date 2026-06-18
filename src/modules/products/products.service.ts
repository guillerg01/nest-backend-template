import { BadRequestException, Injectable } from '@nestjs/common';
import slugify from 'slugify';
import { nanoid } from 'nanoid';
import { CrudService } from '../../shared/base/crud.service';
import { ProductEntity } from './entities/product.entity';
import { ProductDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductRepository } from './repositories/product.repository';
import { PaginationDto } from '../../shared/base/pagination.dto';
import { FindAllResult } from '../../shared/base/base.dto';

@Injectable()
export class ProductsService extends CrudService<ProductEntity, ProductDto, ProductRepository> {
  constructor(private readonly productRepo: ProductRepository) {
    super(productRepo, ProductDto);
  }

  async createProduct(dto: CreateProductDto, ownerId: string): Promise<ProductDto> {
    const slug = await this.generateUniqueSlug(dto.name);
    return this.create({ ...dto, slug, ownerId });
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductDto> {
    return this.update(id, dto);
  }

  async findBySlug(slug: string): Promise<ProductDto> {
    const entity = await this.productRepo.findBySlug(slug);
    if (!entity) throw new BadRequestException(`Product not found: ${slug}`);
    await this.productRepo.incrementViewCount(entity.id);
    return this.toDto(entity);
  }

  async findActive(params: PaginationDto): Promise<FindAllResult<ProductDto>> {
    const result = await this.productRepo.findActive(params);
    return { ...result, data: this.toDtoList(result.data) };
  }

  async search(query: string): Promise<ProductDto[]> {
    const entities = await this.productRepo.search(query);
    return this.toDtoList(entities);
  }

  async findByOwner(ownerId: string, params: PaginationDto): Promise<FindAllResult<ProductDto>> {
    const result = await this.productRepo.findByOwner(ownerId, params);
    return { ...result, data: this.toDtoList(result.data) };
  }

  // Expose protected methods as public for use in controller
  toDto(entity: ProductEntity): ProductDto {
    return super.toDto(entity);
  }

  toDtoList(entities: ProductEntity[]): ProductDto[] {
    return super.toDtoList(entities);
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name, { lower: true, strict: true });
    const existing = await this.productRepo.findBySlug(base);
    return existing ? `${base}-${nanoid(6)}` : base;
  }
}
