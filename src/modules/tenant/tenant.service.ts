import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from './entities/tenant.entity';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
  ) {}

  async findAll(): Promise<TenantEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<TenantEntity> {
    const tenant = await this.repo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  async findBySlug(slug: string): Promise<TenantEntity | null> {
    return this.repo.findOne({ where: { slug } });
  }

  async create(dto: CreateTenantDto): Promise<TenantEntity> {
    const exists = await this.repo.findOne({ where: { slug: dto.slug } });
    if (exists) throw new BadRequestException(`Slug "${dto.slug}" already taken`);
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantEntity> {
    const tenant = await this.findById(id);
    Object.assign(tenant, dto);
    return this.repo.save(tenant);
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.findById(id);
    await this.repo.softRemove(tenant);
  }
}
