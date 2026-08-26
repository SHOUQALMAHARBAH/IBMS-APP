import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SecurityConfigUpdateDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  idleTimeoutMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  hardLogoutAfterIdleMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  accessTokenTtlMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  refreshTokenTtlDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  stepUpMaxAgeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxFailedLoginAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  lockoutMinutes?: number;
}
