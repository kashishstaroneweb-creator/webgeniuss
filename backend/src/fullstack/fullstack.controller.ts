import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerateFullStackDto } from './dto/generate-fullstack.dto';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';

@Controller('fullstack')
export class FullStackController {
  constructor(private readonly coordinator: FullStackCoordinatorService) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generate(@CurrentUser() user: any, @Body() dto: GenerateFullStackDto) {
    const userId = user.id || user._id?.toString();
    return this.coordinator.generate(userId, dto.prompt, dto.websiteName);
  }
}
