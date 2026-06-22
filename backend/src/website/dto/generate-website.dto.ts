import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class V0AttachmentDto {
  @IsString()
  @IsNotEmpty()
  url: string;
}

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
  displayPrompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(['next', 'react', 'html'])
  framework?: 'next' | 'react' | 'html';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => V0AttachmentDto)
  @IsOptional()
  attachments?: V0AttachmentDto[];

  @IsString()
  @IsOptional()
  templateId?: string;
}

