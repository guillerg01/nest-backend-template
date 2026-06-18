import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { PaginationDto } from '../../shared/base/pagination.dto';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Permissions } from '../../shared/decorators/permissions.decorator';
import { Public } from '../../shared/decorators/public.decorator';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List active products (public)' })
  findAll(@Query() params: PaginationDto) {
    return this.productsService.findActive(params);
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Search products by name/description (public)' })
  search(@Query('q') query: string) {
    return this.productsService.search(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get product by slug (public, increments view count)' })
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Get('admin/all')
  @Permissions('products.read')
  @ApiOperation({ summary: 'List all products (admin, includes drafts)' })
  findAllAdmin(@Query() params: PaginationDto) {
    return this.productsService.findAll(params);
  }

  @Get('my/products')
  @ApiOperation({ summary: 'Get current user products' })
  findMine(@CurrentUser('id') userId: string, @Query() params: PaginationDto) {
    return this.productsService.findByOwner(userId, params);
  }

  @Post()
  @ApiOperation({ summary: 'Create product' })
  create(@Body() dto: CreateProductDto, @CurrentUser('id') userId: string) {
    return this.productsService.createProduct(dto, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.updateProduct(id, dto);
  }

  @Delete(':id')
  @Permissions('products.delete')
  @ApiOperation({ summary: 'Soft-delete product' })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
