import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../entities/role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';

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
}
