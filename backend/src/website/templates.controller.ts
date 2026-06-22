import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebsiteService } from './website.service';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private websiteService: WebsiteService) {}

  @Get()
  async listTemplates() {
    return this.websiteService.listPublishedTemplates();
  }

  @Get(':id')
  async getTemplate(@Param('id') id: string) {
    return this.websiteService.getPublishedTemplateById(id);
  }
}
