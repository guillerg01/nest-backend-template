import { Column, Entity, ManyToMany, JoinTable, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * Example CRUD entity demonstrating common field patterns:
 * - Enums, decimal columns, JSONB, array columns
 * - Slug for SEO-friendly URLs
 * - Full-text search with index
 * - ManyToMany with self-managed table
 * - Soft delete (inherited from BaseEntity)
 */
@Entity('products')
@Index(['status', 'isActive']) // Compound index — most queries filter by both
export class ProductEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'compare_at_price' })
  compareAtPrice: number;

  @Column({ name: 'stock_quantity', default: 0 })
  stockQuantity: number;

  @Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.DRAFT })
  status: ProductStatus;

  @Column({ name: 'image_url', nullable: true })
  imageUrl: string;

  @Column({ type: 'jsonb', nullable: true })
  images: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'category_id', nullable: true })
  categoryId: string;

  @Column({ name: 'owner_id', nullable: true })
  ownerId: string;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId: string;

  @Column({ name: 'view_count', default: 0 })
  viewCount: number;

  get isInStock(): boolean {
    return this.stockQuantity > 0;
  }

  get discountPercent(): number | null {
    if (!this.compareAtPrice || this.compareAtPrice <= this.price) return null;
    return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
  }
}
