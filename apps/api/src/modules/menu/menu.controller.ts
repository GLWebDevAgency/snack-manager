import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CategoryCreateSchema,
  CategoryUpdateSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  ReorderSchema,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public, Roles, TenantId } from '../../common/auth';
import { MenuService } from './menu.service';
import { TenantsService } from '../tenants/tenants.service';

@Controller()
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('menu')
  fullMenu(@TenantId() tenantId: string) {
    return this.menu.fullMenu(tenantId);
  }

  @Public()
  @Get('public/tenants/:slug/menu')
  async publicMenu(@Param('slug') slug: string) {
    const tenant = await this.tenants.bySlug(slug);
    return this.menu.publicMenu(String(tenant._id));
  }

  // ─── Catégories (gérant) ───

  @Roles('owner', 'gerant')
  @Post('categories')
  createCategory(@TenantId() tenantId: string, @Body(zod(CategoryCreateSchema)) body: unknown) {
    return this.menu.createCategory(tenantId, body as { name: string });
  }

  @Roles('owner', 'gerant')
  @Post('categories/reorder')
  reorder(@TenantId() tenantId: string, @Body(zod(ReorderSchema)) body: { ids: string[] }) {
    return this.menu.reorderCategories(tenantId, body.ids);
  }

  @Roles('owner', 'gerant')
  @Patch('categories/:id')
  updateCategory(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(CategoryUpdateSchema)) body: Record<string, unknown>,
  ) {
    return this.menu.updateCategory(tenantId, id, body);
  }

  @Roles('owner', 'gerant')
  @Delete('categories/:id')
  deleteCategory(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    return this.menu.deleteCategory(tenantId, id, force === 'true');
  }

  // ─── Produits (gérant) ───

  @Roles('owner', 'gerant')
  @Post('products')
  createProduct(@TenantId() tenantId: string, @Body(zod(ProductCreateSchema)) body: unknown) {
    return this.menu.createProduct(tenantId, body as Record<string, unknown>);
  }

  @Roles('owner', 'gerant')
  @Patch('products/:id')
  updateProduct(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(ProductUpdateSchema)) body: Record<string, unknown>,
  ) {
    return this.menu.updateProduct(tenantId, id, body);
  }

  @Roles('owner', 'gerant')
  @Delete('products/:id')
  deleteProduct(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.menu.deleteProduct(tenantId, id);
  }

  /** Rupture 1-tap — accessible caisse et cuisine aussi. */
  @Post('products/:id/stock')
  setStock(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { outOfStock: boolean },
  ) {
    return this.menu.setStock(tenantId, id, !!body.outOfStock);
  }
}
