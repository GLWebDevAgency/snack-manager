import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from '../../common/auth';
import { SessionAccessService } from '../../common/session-access';
import { SessionRevocationPublisher } from '../../common/session-revocation';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionAccessService,
    SessionRevocationPublisher,
    // Guard global : toute route est authentifiée sauf @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, SessionAccessService, SessionRevocationPublisher],
})
export class AuthModule {}
