import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRepository } from '../users/repositories/user.repository';
import { UserEntity, UserProvider } from '../users/entities/user.entity';

jest.mock('bcryptjs');
jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'mock-nano-id-32chars00000000000000') }));

const makeUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: 'user-uuid',
    email: 'user@test.com',
    password: 'hashed',
    firstName: 'John',
    lastName: 'Doe',
    provider: UserProvider.LOCAL,
    isEmailVerified: false,
    isActive: true,
    role: null,
    ...overrides,
  } as UserEntity);

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let userRepo: jest.Mocked<UserRepository>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    usersService = { createUser: jest.fn() } as any;
    userRepo = {
      findByEmail: jest.fn(),
      findOne: jest.fn(),
      findByResetToken: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    } as any;
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
      verify: jest.fn(),
    } as any;
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, string> = {
          JWT_SECRET: 'secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_EXPIRES_IN: '1d',
          JWT_REFRESH_EXPIRES_IN: '7d',
          HASH_SALT: '10',
        };
        return map[key];
      }),
    } as any;

    service = new AuthService(usersService, userRepo, jwtService, configService);
  });

  describe('validateUser', () => {
    it('returns user when credentials valid', async () => {
      const user = makeUser();
      userRepo.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('user@test.com', 'password');

      expect(result).toEqual(user);
    });

    it('returns null when user not found', async () => {
      userRepo.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('noone@test.com', 'pass');

      expect(result).toBeNull();
    });

    it('returns null when password wrong', async () => {
      userRepo.findByEmail.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('user@test.com', 'wrong');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('updates lastLoginAt and returns tokens + user', async () => {
      const user = makeUser();
      userRepo.update.mockResolvedValue(user);
      jwtService.signAsync.mockResolvedValue('jwt-token');

      const result = await service.login(user);

      expect(userRepo.update).toHaveBeenCalledWith('user-uuid', expect.objectContaining({ lastLoginAt: expect.any(Date) }));
      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('jwt-token');
      expect(result.user).toBeDefined();
    });
  });

  describe('forgotPassword', () => {
    it('returns safe message when user not found (no leak)', async () => {
      userRepo.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'noone@test.com' });

      expect(result.message).toContain('If the email exists');
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('saves reset token when user exists', async () => {
      const user = makeUser();
      userRepo.findByEmail.mockResolvedValue(user);
      userRepo.update.mockResolvedValue(user);

      const result = await service.forgotPassword({ email: user.email });

      expect(userRepo.update).toHaveBeenCalledWith(
        'user-uuid',
        expect.objectContaining({
          passwordResetToken: expect.any(String),
          passwordResetExpires: expect.any(Date),
        }),
      );
      expect(result.message).toContain('If the email exists');
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException for invalid token', async () => {
      userRepo.findByResetToken.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'bad-token', newPassword: 'NewPass123!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates password and clears token on success', async () => {
      const user = makeUser();
      userRepo.findByResetToken.mockResolvedValue(user);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');
      userRepo.update.mockResolvedValue(user);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'NewPass123!',
      });

      expect(userRepo.update).toHaveBeenCalledWith('user-uuid', {
        password: 'new-hashed-password',
        passwordResetToken: null,
        passwordResetExpires: null,
      });
      expect(result.message).toContain('Password updated');
    });
  });

  describe('refreshTokens', () => {
    it('throws UnauthorizedException for invalid token', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('invalid'); });

      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('returns new tokens for valid refresh token', async () => {
      const user = makeUser();
      jwtService.verify.mockReturnValue({ sub: 'user-uuid', email: user.email });
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue(user);
      jwtService.signAsync.mockResolvedValue('new-token');

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBe('new-token');
    });
  });
});
