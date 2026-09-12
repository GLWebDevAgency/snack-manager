import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DiningAddOrderSchema, DiningServeSchema, DiningSessionOpenSchema, DiningSessionOperationSchema, DiningSessionTransferSchema, DiningTableCreateSchema, DiningTableUpdateSchema, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { DiningService } from './dining.service';

@Controller('dining')
export class DiningController {
  constructor(private readonly dining: DiningService) {}
  @Get('room') @Roles('owner', 'gerant', 'caisse', 'cuisine')
  room(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload) { return this.dining.room(tenantId, actor); }
  @Get('sessions/:id') @Roles('owner', 'gerant', 'caisse', 'cuisine')
  detail(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: JwtPayload) { return this.dining.detail(tenantId, id, actor); }
  @Post('tables') @Roles('owner', 'gerant')
  createTable(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningTableCreateSchema)) body: unknown) { return this.dining.createTable(tenantId, actor, body); }
  @Patch('tables/:id') @Roles('owner', 'gerant')
  updateTable(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningTableUpdateSchema)) body: unknown) { return this.dining.updateTable(tenantId, id, actor, body); }
  @Post('sessions') @HttpCode(200) @Roles('owner', 'gerant', 'caisse')
  open(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningSessionOpenSchema)) body: unknown) { return this.dining.open(tenantId, actor, body); }
  @Post('sessions/:id/transfer') @HttpCode(200) @Roles('owner', 'gerant', 'caisse')
  transfer(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningSessionTransferSchema)) body: unknown) { return this.dining.transfer(tenantId, id, actor, body); }
  @Post('sessions/:id/close') @HttpCode(200) @Roles('owner', 'gerant', 'caisse')
  close(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningSessionOperationSchema)) body: unknown) { return this.dining.close(tenantId, id, actor, body); }
  @Post('sessions/:id/orders') @HttpCode(200) @Roles('owner', 'gerant', 'caisse')
  addOrder(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: JwtPayload, @Body(zod(DiningAddOrderSchema)) body: unknown) { return this.dining.addOrder(tenantId, id, actor, body); }
  @Post('sessions/:id/orders/:orderId/serve') @HttpCode(200) @Roles('owner', 'gerant', 'caisse')
  serve(@TenantId() tenantId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('orderId') orderId: string,
    @CurrentUser() actor: JwtPayload, @Body(zod(DiningServeSchema)) body: unknown) { return this.dining.serve(tenantId, id, orderId, actor, body); }
}
