import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PrincipalService } from "./principal.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { VerificationService } from "./verification.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    PrincipalService,
    AuthService,
    PasswordService,
    TokenService,
    VerificationService,
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenService,
    VerificationService,
    PrincipalService,
  ],
})
export class AuthModule {}
