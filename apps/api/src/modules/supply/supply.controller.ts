import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  BomPutSchema,
  BrandCreateSchema,
  BrandUpdateSchema,
  INGREDIENT_CATEGORIES,
  IngredientCreateSchema,
  IngredientOutSchema,
  IngredientUpdateSchema,
  MovementCreateSchema,
  OptionBomPutSchema,
  SupplierCreateSchema,
  SupplierItemCreateSchema,
  SupplierItemUpdateSchema,
  SupplierUpdateSchema,
  type BomPut,
  type BrandCreate,
  type BrandUpdate,
  type IngredientCategory,
  type IngredientCreate,
  type IngredientOut,
  type IngredientUpdate,
  type MovementCreate,
  type OptionBomPut,
  type SupplierCreate,
  type SupplierItemCreate,
  type SupplierItemUpdate,
  type SupplierUpdate,
  type JwtPayload,
} from '@sm/contracts';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { SupplyService } from './supply.service';

@Controller('supply')
@Fonction('ingredients')
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}

  // ─── Ingrédients ───

  // ─── LES LECTURES, désormais déclarées ───
  //
  // Elles ne portaient AUCUN rôle, et l'absence de `@Roles` vaut « tout rôle
  // authentifié » : un code cuisine lisait les prix d'achat, les marges par
  // produit et l'historique des tarifs fournisseurs. Les écritures étaient
  // protégées depuis toujours ; c'est la lecture qui laissait passer
  // l'information la plus sensible du restaurant.

  /**
   * La cuisine déclare les ruptures depuis le KDS : elle doit voir la liste
   * qu'elle alimente. Les PRIX d'achat, eux, ne sortent pas de cette route.
   */
  @Roles('owner', 'gerant', 'cuisine')
  @Get('ingredients')
  listIngredients(
    @TenantId() tenantId: string,
    @Query('q') q?: string,
    @Query('category') category?: string,
  ) {
    if (category !== undefined && !(INGREDIENT_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException('Catégorie inconnue');
    }
    return this.supply.listIngredients(tenantId, q, category as IngredientCategory | undefined);
  }

  @Roles('owner', 'gerant')
  @Post('ingredients')
  createIngredient(
    @TenantId() tenantId: string,
    @Body(zod(IngredientCreateSchema)) body: IngredientCreate,
  ) {
    return this.supply.createIngredient(tenantId, body);
  }

  @Roles('owner', 'gerant')
  @Patch('ingredients/:id')
  updateIngredient(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(IngredientUpdateSchema)) body: IngredientUpdate,
  ) {
    return this.supply.updateIngredient(tenantId, id, body, user);
  }

  @Roles('owner', 'gerant')
  @Delete('ingredients/:id')
  deleteIngredient(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.supply.deleteIngredient(tenantId, id, user);
  }

  /** Rupture ingrédient + cascade produits — la cuisine peut la déclarer depuis le KDS. */
  @Roles('owner', 'gerant', 'cuisine')
  @Post('ingredients/:id/out')
  setIngredientOut(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(IngredientOutSchema)) body: IngredientOut,
  ) {
    return this.supply.setIngredientOut(tenantId, id, body.isOut, user);
  }

  // ─── Marques ───

  @Roles('owner', 'gerant')
  @Post('ingredients/:id/brands')
  addBrand(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(BrandCreateSchema)) body: BrandCreate,
  ) {
    return this.supply.addBrand(tenantId, id, body);
  }

  @Roles('owner', 'gerant')
  @Patch('brands/:brandId')
  updateBrand(
    @TenantId() tenantId: string,
    @Param('brandId') brandId: string,
    @Body(zod(BrandUpdateSchema)) body: BrandUpdate,
  ) {
    return this.supply.updateBrand(tenantId, brandId, body);
  }

  @Roles('owner', 'gerant')
  @Delete('brands/:brandId')
  deleteBrand(@TenantId() tenantId: string, @Param('brandId') brandId: string) {
    return this.supply.deleteBrand(tenantId, brandId);
  }

  // ─── Fournisseurs & catalogue ───

  @Roles('owner', 'gerant')
  @Get('suppliers')
  listSuppliers(@TenantId() tenantId: string) {
    return this.supply.listSuppliers(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('suppliers')
  createSupplier(
    @TenantId() tenantId: string,
    @Body(zod(SupplierCreateSchema)) body: SupplierCreate,
  ) {
    return this.supply.createSupplier(tenantId, body);
  }

  @Roles('owner', 'gerant')
  @Patch('suppliers/:id')
  updateSupplier(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(SupplierUpdateSchema)) body: SupplierUpdate,
  ) {
    return this.supply.updateSupplier(tenantId, id, body);
  }

  @Roles('owner', 'gerant')
  @Delete('suppliers/:id')
  deleteSupplier(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.supply.deleteSupplier(tenantId, id);
  }

  @Roles('owner', 'gerant')
  @Post('suppliers/:id/items')
  addSupplierItem(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(SupplierItemCreateSchema)) body: SupplierItemCreate,
  ) {
    return this.supply.addSupplierItem(tenantId, id, body);
  }

  @Roles('owner', 'gerant')
  @Patch('items/:itemId')
  updateSupplierItem(
    @TenantId() tenantId: string,
    @Param('itemId') itemId: string,
    @Body(zod(SupplierItemUpdateSchema)) body: SupplierItemUpdate,
  ) {
    return this.supply.updateSupplierItem(tenantId, itemId, body);
  }

  @Roles('owner', 'gerant')
  @Get('items/:itemId/price-history')
  priceHistory(@TenantId() tenantId: string, @Param('itemId') itemId: string) {
    return this.supply.priceHistory(tenantId, itemId);
  }

  // ─── Recettes / BOM & coût matière ───

  @Roles('owner', 'gerant')
  @Get('products/:productRef/bom')
  bom(@TenantId() tenantId: string, @Param('productRef') productRef: string) {
    return this.supply.bom(tenantId, productRef);
  }

  @Roles('owner', 'gerant')
  @Put('products/:productRef/bom')
  putBom(
    @TenantId() tenantId: string,
    @Param('productRef') productRef: string,
    @Body(zod(BomPutSchema)) body: BomPut,
  ) {
    return this.supply.putBom(tenantId, productRef, body);
  }

  @Roles('owner', 'gerant')
  @Put('products/:productRef/option-bom')
  putOptionBom(
    @TenantId() tenantId: string,
    @Param('productRef') productRef: string,
    @Body(zod(OptionBomPutSchema)) body: OptionBomPut,
  ) {
    return this.supply.putOptionBom(tenantId, productRef, body);
  }

  /** Batch pour la vue Menu : `?refs=id1,id2` → { ref: { costCents, marginPct } }. */
  @Roles('owner', 'gerant')
  @Get('costs')
  costs(@TenantId() tenantId: string, @Query('refs') refs?: string) {
    if (!refs) throw new BadRequestException('Paramètre refs requis');
    const list = refs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return {};
    if (list.length > 200) throw new BadRequestException('200 produits maximum par appel');
    return this.supply.costs(tenantId, list);
  }

  // ─── Alertes ───

  /**
   * Les alertes de stock servent d'abord en cuisine — c'est là qu'on
   * constate qu'il manque quelque chose.
   */
  @Roles('owner', 'gerant', 'cuisine')
  @Get('alerts')
  alerts(@TenantId() tenantId: string) {
    return this.supply.alerts(tenantId);
  }

  // ─── Mouvements de stock ───

  @Roles('owner', 'gerant')
  @Post('movements')
  createMovement(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(MovementCreateSchema)) body: MovementCreate,
  ) {
    return this.supply.createMovement(tenantId, body, user);
  }

  @Roles('owner', 'gerant')
  @Get('movements')
  listMovements(
    @TenantId() tenantId: string,
    @Query('ingredientId') ingredientId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    const capped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    return this.supply.listMovements(tenantId, ingredientId || undefined, capped);
  }
}
