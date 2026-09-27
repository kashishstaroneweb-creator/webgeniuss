import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class RenameWebsiteDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  websiteName: string;
}
