import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { WebsiteService } from './website.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../entities/user.entity';
import { GenerateWebsiteDto } from './dto/generate-website.dto';

@Controller('website')
export class WebsiteController {
  constructor(private websiteService: WebsiteService) {}

  @Post('generate')
  // Temporarily removed authentication for testing
  async generate(
    @Body() generateDto: GenerateWebsiteDto,
  ) {
    console.log('WebsiteController.generate - Request received (NO AUTH):', {
      prompt: generateDto.prompt?.substring(0, 50),
      websiteName: generateDto.websiteName,
    });
    
    // Use test userId for now - replace with actual user lookup later
    const userId = generateDto.userId || '691df5ddac69fc46beca44b3'; // Test user ID
    
    console.log('WebsiteController.generate - Using test userId:', userId);
    
    try {
      const result = await this.websiteService.generateWebsite(
        userId,
        generateDto.prompt,
        generateDto.websiteName || `Website ${Date.now()}`,
      );
      console.log('WebsiteController.generate - Success, website ID:', result.id);
      return result;
    } catch (error: any) {
      const message = error?.message || 'Unknown error during website generation';
      const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      console.error('WebsiteController.generate - Error:', message, error?.stack);
      throw new HttpException(
        { message, statusCode: status, error: 'Website generation failed' },
        status,
        { cause: error },
      );
    }
  }

  @Get('list')
  async listWebsites(@Query('userId') userId?: string) {
    // Use provided userId or default test userId for now
    const targetUserId = userId || '691df5ddac69fc46beca44b3';
    return this.websiteService.getUserWebsites(targetUserId);
  }

  @Get('placeholder-image')
  async getPlaceholderImage(
    @Query('websiteName') websiteName?: string,
    @Query('prompt') prompt?: string,
    @Query('width') width?: string,
    @Query('height') height?: string,
  ) {
    const w = Math.min(1200, Math.max(48, parseInt(width || '400', 10) || 400));
    const h = Math.min(800, Math.max(48, parseInt(height || '300', 10) || 300));
    const url = await this.websiteService.getValidatedPlaceholderImage(
      websiteName || '',
      prompt || '',
      w,
      h,
    );
    if (!url) {
      throw new HttpException(
        { message: 'No Unsplash image available', statusCode: 404 },
        HttpStatus.NOT_FOUND,
      );
    }
    return { url };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getWebsite(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = user.id || (user._id?.toString());
    return this.websiteService.getWebsiteById(id, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteWebsite(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = user.id || (user._id?.toString());
    return this.websiteService.deleteWebsite(id, userId);
  }
}

