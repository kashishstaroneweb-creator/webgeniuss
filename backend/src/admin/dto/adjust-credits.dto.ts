import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdjustCreditsDto {
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  referenceId?: string;
}
