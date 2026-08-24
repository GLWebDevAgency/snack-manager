import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginSchema, PinLoginSchema, type Login, type PinLogin } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public } from '../../common/auth';
import { AuthService } from './auth.service';

/**
 * 10 essais par minute et par adresse : un humain qui se trompe ne les
 * atteint jamais, un dictionnaire si. C'était l'un des trous du diagnostic
 * quatre casquettes (P3) — aucune limite nulle part, connexion comprise.
 */
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body(zod(LoginSchema)) body: Login) {
    return this.auth.login(body);
  }

  @Public()
  @HttpCode(200)
  @Post('pin')
  pin(@Body(zod(PinLoginSchema)) body: PinLogin) {
    return this.auth.loginPin(body);
  }
}
