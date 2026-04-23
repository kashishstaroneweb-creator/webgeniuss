import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class FinalizeV0ChatDto {
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @IsString()
  @IsOptional()
  websiteName?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  /** Stored on the website row and in prompt history when provided. */
  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  framework?: 'next' | 'react';
}
