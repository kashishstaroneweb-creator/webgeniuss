import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { GenerateFullStackDto } from './dto/generate-fullstack.dto';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';

@Controller('fullstack')
export class FullStackController {
  constructor(private readonly coordinator: FullStackCoordinatorService) {}

  @Post('generate')
  generate(@Body() dto: GenerateFullStackDto) {
    return this.coordinator.generate(dto.prompt, dto.websiteName);
  }

  @Get(':id/project')
  project(@Param('id') id: string) {
    return this.coordinator.getProject(id);
  }
}
