import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { V0AttachmentDto } from './generate-website.dto';

export class SectionTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tag: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  id?: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  classes: string[];

  @IsString()
  @IsOptional()
  @MaxLength(240)
  textPreview?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  domPath: string;
}

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

  @ValidateNested()
  @Type(() => SectionTargetDto)
  @IsOptional()
  targetSection?: SectionTargetDto;
}
