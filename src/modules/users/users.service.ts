import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { CrudService } from '../../shared/base/crud.service';
import { UserEntity } from './entities/user.entity';
import { UserDto } from './dto/user.dto';
import { UserRepository } from './repositories/user.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService extends CrudService<UserEntity, UserDto, UserRepository> {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
  ) {
    super(userRepo, UserDto);
  }

  async createUser(dto: CreateUserDto): Promise<UserDto> {
    const exists = await this.userRepo.findByEmail(dto.email);
    if (exists) throw new BadRequestException('Email already in use');

    const salt = parseInt(this.config.get('HASH_SALT') || '10');
    const password = await bcrypt.hash(dto.password, salt);

    return this.create({ ...dto, password });
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserDto> {
    return this.update(id, dto);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepo.findByEmail(email);
  }

  async validatePassword(user: UserEntity, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async markEmailVerified(token: string): Promise<void> {
    const user = await this.userRepo.findByEmailVerificationToken(token);
    if (!user) throw new BadRequestException('Invalid or expired token');
    await this.userRepo.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
    });
  }

  async getMe(userId: string): Promise<UserDto> {
    return this.findById(userId);
  }
}
