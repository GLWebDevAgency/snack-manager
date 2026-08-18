import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { LoginSchema, PinLoginSchema, type Login, type PinLogin } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public } from '../../common/auth';
import { AuthService } from './auth.service';

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
