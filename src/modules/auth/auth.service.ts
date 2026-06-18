import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { UsersService } from '../users/users.service';
import { UserRepository } from '../users/repositories/user.repository';
import { UserEntity, UserProvider } from '../users/entities/user.entity';
import { CreateUserDto } from '../users/dto/create-user.dto';
import {
  AuthResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly userRepo: UserRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<UserEntity | null> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
  }

  async login(user: UserEntity): Promise<AuthResponseDto> {
    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    const tokens = await this.generateTokens(user);
    return { ...tokens, user: new (await import('../users/dto/user.dto')).UserDto().fromEntity(user) };
  }

  async register(dto: CreateUserDto): Promise<AuthResponseDto> {
    const userDto = await this.usersService.createUser(dto);
    const user = await this.userRepo.findByEmail(dto.email);

    // In production: send email verification
    const verificationToken = nanoid(32);
    await this.userRepo.update(user.id, { emailVerificationToken: verificationToken });

    return this.login(user);
  }

  async googleLogin(profile: any): Promise<AuthResponseDto> {
    let user = await this.userRepo.findByEmail(profile.email);

    if (!user) {
      const created = await this.userRepo.create({
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        provider: UserProvider.GOOGLE,
        providerId: profile.providerId,
        isEmailVerified: true,
      });
      user = created;
    }

    return this.login(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      const user = await this.userRepo.findOne({ id: payload.sub });
      if (!user) throw new UnauthorizedException();
      return this.login(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) return { message: 'If the email exists, a reset link was sent' };

    const token = nanoid(32);
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h

    await this.userRepo.update(user.id, {
      passwordResetToken: token,
      passwordResetExpires: expires,
    });

    // TODO: inject NotificationsService and send email
    // await this.notificationsService.sendPasswordReset(user.email, token);

    return { message: 'If the email exists, a reset link was sent' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepo.findByResetToken(dto.token);
    if (!user) throw new BadRequestException('Invalid or expired token');

    const salt = parseInt(this.config.get('HASH_SALT') || '10');
    const hashed = await bcrypt.hash(dto.newPassword, salt);

    await this.userRepo.update(user.id, {
      password: hashed,
      passwordResetToken: null,
      passwordResetExpires: null,
    });

    return { message: 'Password updated successfully' };
  }

  private async generateTokens(user: UserEntity) {
    const payload = { sub: user.id, email: user.email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN') || '1d',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') || '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
