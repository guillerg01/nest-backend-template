import { ApiProperty } from '@nestjs/swagger';
import { BaseDto } from '../../../shared/base/base.dto';
import { UserProvider } from '../entities/user.entity';

export class UserDto extends BaseDto {
  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  avatarUrl: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: UserProvider })
  provider: UserProvider;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty()
  lastLoginAt: Date;

  @ApiProperty({ required: false })
  role?: { id: string; name: string };

  fromEntity(entity: any): this {
    super.fromEntity(entity);
    this.email = entity?.email ?? '';
    this.firstName = entity?.firstName ?? '';
    this.lastName = entity?.lastName ?? '';
    this.avatarUrl = entity?.avatarUrl ?? null;
    this.phone = entity?.phone ?? null;
    this.provider = entity?.provider;
    this.isEmailVerified = entity?.isEmailVerified ?? false;
    this.lastLoginAt = entity?.lastLoginAt ?? null;
    this.role = entity?.role
      ? { id: entity.role.id, name: entity.role.name }
      : null;
    return this;
  }
}
