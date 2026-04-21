import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class EditWebsiteDto {
  @IsString()
  @IsNotEmpty()
  editPrompt: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['next', 'react'])
  framework?: 'next' | 'react';
}
