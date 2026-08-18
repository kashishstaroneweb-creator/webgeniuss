import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateFullStackDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(12_000)
  prompt: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  websiteName?: string;
}
