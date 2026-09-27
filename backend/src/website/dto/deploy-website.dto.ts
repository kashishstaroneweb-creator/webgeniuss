import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeployWebsiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  backendUrl?: string;
}
