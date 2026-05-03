import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class GenerateWebsiteDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsString()
  websiteName: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['next', 'react', 'html'])
  framework?: 'next' | 'react' | 'html';
}

