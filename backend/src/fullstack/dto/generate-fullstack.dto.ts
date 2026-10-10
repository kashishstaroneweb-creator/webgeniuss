import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export type FullStackGenerationMode = 'simple' | 'production-app' | 'production-crm';

export class GenerateFullStackDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(12_000)
  prompt: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  websiteName?: string;

  @IsString()
  @IsOptional()
  @IsIn(['simple', 'production-app', 'production-crm'])
  mode?: FullStackGenerationMode;
}
