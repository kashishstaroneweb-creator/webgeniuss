import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  basePrompt?: string;

  @IsString()
  @IsOptional()
  status?: 'draft' | 'published' | 'archived';

  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @IsBoolean()
  @IsOptional()
  isPremium?: boolean;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
