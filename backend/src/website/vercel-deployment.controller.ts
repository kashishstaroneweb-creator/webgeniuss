import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VercelDeploymentService } from './vercel-deployment.service';
import { DeployWebsiteDto } from './dto/deploy-website.dto';

@Controller('website/:id/vercel')
@UseGuards(JwtAuthGuard)
export class VercelDeploymentController {
  constructor(private readonly service: VercelDeploymentService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Param('id') id: string, @CurrentUser() user: any) { return this.service.status(id, user.id || user._id?.toString()); }
  @Post()
  @Header('Cache-Control', 'no-store')
  deploy(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: DeployWebsiteDto) {
    return this.service.deploy(id, user.id || user._id?.toString(), dto);
  }
}
