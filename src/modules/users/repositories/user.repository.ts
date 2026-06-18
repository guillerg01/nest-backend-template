import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseRepository } from '../../../shared/base/base.repository';
import { UserEntity } from '../entities/user.entity';

@Injectable()
export class UserRepository extends BaseRepository<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {
    super(userRepo);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepo.findOne({
      where: { email },
      relations: ['role', 'role.permissions'],
    });
  }

  async findByResetToken(token: string): Promise<UserEntity | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .where('user.passwordResetToken = :token', { token })
      .andWhere('user.passwordResetExpires > :now', { now: new Date() })
      .getOne();
  }

  async findByEmailVerificationToken(token: string): Promise<UserEntity | null> {
    return this.userRepo.findOne({ where: { emailVerificationToken: token } });
  }
}
