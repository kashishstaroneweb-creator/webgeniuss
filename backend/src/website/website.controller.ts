import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, HttpException, HttpStatus, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { WebsiteService } from './website.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GenerateWebsiteDto } from './dto/generate-website.dto';
import * as path from 'path';
import * as fs from 'fs';

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

  /** Serve built preview SPA (index.html or assets). Define before :id so these match first. */
  @Get('preview/:userId/:websiteId')
  async servePreviewIndex(
    @Param('userId') userId: string,
    @Param('websiteId') websiteId: string,
    @Res() res: Response,
  ) {
    const distDir = path.join(process.cwd(), 'generated_sites', userId, websiteId, 'dist');
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      throw new HttpException({ message: 'Preview not built or not found', statusCode: 404 }, HttpStatus.NOT_FOUND);
    }
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.resolve(indexPath));
  }

  @Get('preview/:userId/:websiteId/:path1')
  async servePreviewAsset1(
    @Param('userId') userId: string,
    @Param('websiteId') websiteId: string,
    @Param('path1') path1: string,
    @Res() res: Response,
  ) {
    this.servePreviewFile(res, userId, websiteId, path1, undefined);
  }

  @Get('preview/:userId/:websiteId/:path1/:path2')
  async servePreviewAsset2(
    @Param('userId') userId: string,
    @Param('websiteId') websiteId: string,
    @Param('path1') path1: string,
    @Param('path2') path2: string,
    @Res() res: Response,
  ) {
    this.servePreviewFile(res, userId, websiteId, path1, path2);
  }

  private servePreviewFile(
    res: Response,
    userId: string,
    websiteId: string,
    path1: string,
    path2?: string,
  ) {
    const distDir = path.resolve(process.cwd(), 'generated_sites', userId, websiteId, 'dist');
    const relativePath = path2 ? `${path1}/${path2}` : path1;
    const filePath = path.resolve(distDir, relativePath);
    if (!filePath.startsWith(distDir) || relativePath.includes('..')) {
      throw new HttpException({ message: 'Forbidden', statusCode: 403 }, HttpStatus.FORBIDDEN);
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new HttpException({ message: 'Not found', statusCode: 404 }, HttpStatus.NOT_FOUND);
    }
    res.sendFile(filePath);
  }

  @Get(':id/preview')
  async getPreviewUrl(
    @Param('id') websiteId: string,
    @Query('userId') userId?: string,
  ) {
    const uid = userId || '691df5ddac69fc46beca44b3';
    const result = await this.websiteService.getPreviewUrl(websiteId, uid);
    if (result.success === false) {
      throw new HttpException(
        { message: result.error, log: result.log, statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { previewUrl: result.previewUrl };
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

