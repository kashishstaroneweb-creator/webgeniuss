import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { V0AttachmentDto } from './generate-website.dto';

export class EditWebsiteDto {
  @IsString()
  @IsNotEmpty()
  editPrompt: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  displayEditPrompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(['next', 'react', 'html'])
  framework?: 'next' | 'react' | 'html';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => V0AttachmentDto)
  @IsOptional()
  attachments?: V0AttachmentDto[];
}
