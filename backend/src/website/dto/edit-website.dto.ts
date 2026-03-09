import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class EditWebsiteDto {
  @IsString()
  @IsNotEmpty()
  editPrompt: string;

  @IsString()
  @IsOptional()
  userId?: string;
}
