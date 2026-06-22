import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../entities/role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';
import { CreateTemplateFromWebsiteDto } from './dto/create-template-from-website.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.SUPERADMIN, RoleName.ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  private userIdFromRequest(user: any): string {
    return user.id || user._id?.toString();
  }

  @Get('dashboard')
  async dashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  async users() {
    return this.adminService.listUsers();
  }

  @Post('users/:id/credits')
  @Roles(RoleName.SUPERADMIN)
  async adjustCredits(
    @CurrentUser() user: any,
    @Param('id') userId: string,
    @Body() dto: AdjustCreditsDto,
  ) {
    return this.adminService.adjustCredits(userId, dto, this.userIdFromRequest(user));
  }

  @Get('generations')
  async generations() {
    return this.adminService.listGenerations();
  }

  @Get('ledger')
  async ledger(@Query('userId') userId?: string) {
    return this.adminService.listLedger(userId);
  }

  @Get('templates')
  async templates() {
    return this.adminService.listTemplates();
  }

  @Post('templates/from-website/:websiteId')
  async createTemplateFromWebsite(
    @CurrentUser() user: any,
    @Param('websiteId') websiteId: string,
    @Body() dto: CreateTemplateFromWebsiteDto,
  ) {
    return this.adminService.createTemplateFromWebsite(websiteId, dto, this.userIdFromRequest(user));
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.adminService.updateTemplate(id, dto);
  }

  @Post('templates/:id/publish')
  async publishTemplate(@Param('id') id: string) {
    return this.adminService.updateTemplate(id, { status: 'published' });
  }

  @Post('templates/:id/archive')
  async archiveTemplate(@Param('id') id: string) {
    return this.adminService.updateTemplate(id, { status: 'archived' });
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    return this.adminService.deleteTemplate(id);
  }
}
