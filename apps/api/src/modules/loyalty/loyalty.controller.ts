import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  LoyaltyMemberListQuerySchema,
  LoyaltyProgramPutSchema,
  LoyaltyRewardCreateSchema,
  LoyaltyRewardUpdateSchema,
  type LoyaltyMemberListQuery,
  type LoyaltyProgramPut,
  type LoyaltyRewardCreate,
  type LoyaltyRewardUpdate,
} from '@sm/contracts';
import { Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyMemberService } from './loyalty-member.service';

@Controller('loyalty')
@Roles('owner', 'gerant')
@Fonction('fidelite')
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyAdminService,
    private readonly members: LoyaltyMemberService,
  ) {}

  @Get('dashboard')
  @Header('Cache-Control', 'no-store')
  dashboard(@TenantId() tenantRef: string) {
    return this.members.dashboard(tenantRef);
  }

  @Get('members')
  @Header('Cache-Control', 'no-store')
  listMembers(
    @TenantId() tenantRef: string,
    @Query(zod(LoyaltyMemberListQuerySchema)) query: unknown,
  ) {
    return this.members.listMembers(tenantRef, query as LoyaltyMemberListQuery);
  }

  @Get('members/:id')
  @Header('Cache-Control', 'no-store')
  getMember(
    @TenantId() tenantRef: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    return this.members.getMemberDetail(tenantRef, memberId);
  }

  @Get('program')
  @Roles('owner', 'gerant', 'caisse')
  getProgram(@TenantId() tenantRef: string) {
    return this.loyalty.getProgram(tenantRef);
  }

  @Put('program')
  putProgram(
    @TenantId() tenantRef: string,
    @Body(zod(LoyaltyProgramPutSchema)) body: unknown,
  ) {
    return this.loyalty.putProgram(tenantRef, body as LoyaltyProgramPut);
  }

  @Get('rewards')
  @Roles('owner', 'gerant', 'caisse')
  listRewards(@TenantId() tenantRef: string) {
    return this.loyalty.listRewards(tenantRef);
  }

  @Post('rewards')
  createReward(
    @TenantId() tenantRef: string,
    @Body(zod(LoyaltyRewardCreateSchema)) body: unknown,
  ) {
    return this.loyalty.createReward(tenantRef, body as LoyaltyRewardCreate);
  }

  @Patch('rewards/:id')
  updateReward(
    @TenantId() tenantRef: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) rewardId: string,
    @Body(zod(LoyaltyRewardUpdateSchema)) body: unknown,
  ) {
    return this.loyalty.updateReward(tenantRef, rewardId, body as LoyaltyRewardUpdate);
  }
}
import { Fonction } from '../../common/capacites';
