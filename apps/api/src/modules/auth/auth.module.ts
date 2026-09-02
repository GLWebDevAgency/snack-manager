import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentiteController } from './identite.controller';
import { IdentiteService } from './identite.service';
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
  // `IdentiteController` est SÉPARÉ de `AuthController` : celui-ci limite le
  // débit pour protéger la connexion, et ce plafond n'a rien à faire sur une
  // lecture d'identité appelée à chaque ouverture d'écran. Voir son en-tête.
  controllers: [AuthController, IdentiteController],
  providers: [
    AuthService,
    IdentiteService,
    SessionAccessService,
    SessionRevocationPublisher,
    // Guard global : toute route est authentifiée sauf @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, SessionAccessService, SessionRevocationPublisher],
})
export class AuthModule {}
