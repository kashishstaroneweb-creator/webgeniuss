import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, HttpException, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { WebsiteService } from './website.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GenerateWebsiteDto } from './dto/generate-website.dto';
import { FinalizeV0ChatDto } from './dto/finalize-v0-chat.dto';
import { EditWebsiteDto } from './dto/edit-website.dto';

@Controller('website')
export class WebsiteController {
  constructor(private websiteService: WebsiteService) {}

  private userIdFromRequest(user: any): string {
    return user.id || user._id?.toString();
  }

  private scopedEditPrompt(editDto: EditWebsiteDto): string {
    const target = editDto.targetSection;
    if (!target) return editDto.editPrompt;
    const details = [
      `Element: ${target.tag}`,
      target.id ? `ID: ${target.id}` : '',
      target.classes?.length ? `Classes: ${target.classes.join(' ')}` : '',
      `DOM path: ${target.domPath}`,
      target.textPreview ? `Visible text excerpt: ${target.textPreview}` : '',
    ].filter(Boolean);
    const visualGuidance = target.tag === 'visual-region'
      ? 'Use the viewport coordinates to identify the visible section at that point by inspecting the current page structure and rendered layout.'
      : 'Use the element metadata and visible text to identify the exact section in the current source.';
    return [
      'Apply a targeted edit to ONLY the selected website section described below.',
      'Preserve every other section, route, style, behavior, and file unless a tiny supporting change is strictly required.',
      'Do not remove or rewrite unrelated content.',
      visualGuidance,
      'Return the complete updated project files, not only an explanation or patch description.',
      '',
      'Selected section:',
      ...details,
      '',
      'Requested change:',
      editDto.editPrompt,
    ].join('\n');
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  async generate(@CurrentUser() user: any, @Body() generateDto: GenerateWebsiteDto) {
    const userId = this.userIdFromRequest(user);
    console.log('WebsiteController.generate - Request received:', {
      prompt: generateDto.prompt?.substring(0, 50),
      websiteName: generateDto.websiteName,
      userId,
    });

    try {
      const result = await this.websiteService.generateWebsite(
        userId,
        generateDto.prompt,
        generateDto.websiteName || `Website ${Date.now()}`,
        generateDto.framework,
        generateDto.attachments,
        generateDto.displayPrompt,
        generateDto.templateId,
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

  /**
   * v0 experimental_stream: streams raw v0 SSE through, then runs GET /chats/:id + same persist path as POST /website/generate.
   * Terminal SSE: `website-saved` (JSON body), `finalize-required`, or `website-error`.
   */
  @Post('generate-stream')
  @UseGuards(JwtAuthGuard)
  async generateStream(
    @CurrentUser() user: any,
    @Body() generateDto: GenerateWebsiteDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const userId = this.userIdFromRequest(user);
    const websiteName = generateDto.websiteName || `Website ${Date.now()}`;
    try {
      await this.websiteService.pipeV0GenerationStream(
        res,
        userId,
        generateDto.prompt,
        websiteName,
        generateDto.framework,
        generateDto.attachments,
        generateDto.displayPrompt,
        generateDto.templateId,
      );
    } catch (error: any) {
      if (!res.headersSent) {
        const message = error?.message || 'Unknown error during streaming generation';
        const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
        throw new HttpException(
          { message, statusCode: status, error: 'Website stream failed' },
          status,
          { cause: error },
        );
      }
    }
  }

  /** When stream did not yield a chat id, or for clients that only parse id locally. */
  @Post('finalize-v0-chat')
  @UseGuards(JwtAuthGuard)
  async finalizeV0Chat(@CurrentUser() user: any, @Body() dto: FinalizeV0ChatDto) {
    const userId = this.userIdFromRequest(user);
    const websiteName = dto.websiteName || `Website ${Date.now()}`;
    try {
      return await this.websiteService.finalizeWebsiteFromV0Chat(
        userId,
        dto.chatId,
        websiteName,
        dto.prompt ?? '',
        dto.framework,
      );
    } catch (error: any) {
      const message = error?.message || 'Unknown error during finalize';
      const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(
        { message, statusCode: status, error: 'Finalize v0 chat failed' },
        status,
        { cause: error },
      );
    }
  }

  @Get('list')
  @UseGuards(JwtAuthGuard)
  async listWebsites(@CurrentUser() user: any) {
    const userId = this.userIdFromRequest(user);
    return this.websiteService.getUserWebsites(userId);
  }

  @Get('v0-health')
  async v0Health() {
    const result = await this.websiteService.getV0Health();
    if (!result.ok) {
      throw new HttpException(
        { message: 'v0 health check failed', ...result },
        result.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return result;
  }

  @Post('v0-chat-check')
  async v0ChatCheck(@Body() body: { message?: string; system?: string }) {
    const result = await this.websiteService.runV0ChatCheck(
      body?.message || 'make a red button',
      body?.system,
    );
    if (!result.ok) {
      throw new HttpException(
        { message: 'v0 chat check failed', ...result },
        result.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return result;
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

  /**
   * v0 experimental_stream follow-up on the same chat as generation. Terminal SSE: `website-saved`, `website-error`.
   */
  @Post(':id/edit-stream')
  @UseGuards(JwtAuthGuard)
  async editStream(
    @CurrentUser() user: any,
    @Param('id') websiteId: string,
    @Body() editDto: EditWebsiteDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const userId = this.userIdFromRequest(user);
    try {
      await this.websiteService.pipeV0EditStream(
        res,
        userId,
        websiteId,
        this.scopedEditPrompt(editDto),
        editDto.framework,
        editDto.attachments,
        editDto.displayEditPrompt,
      );
    } catch (error: any) {
      if (!res.headersSent) {
        const message = error?.message || 'Unknown error during edit stream';
        const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
        throw new HttpException(
          { message, statusCode: status, error: 'Website edit stream failed' },
          status,
          { cause: error },
        );
      }
    }
  }

  @Post(':id/edit')
  @UseGuards(JwtAuthGuard)
  async editWebsite(
    @CurrentUser() user: any,
    @Param('id') websiteId: string,
    @Body() editDto: EditWebsiteDto,
  ) {
    const userId = this.userIdFromRequest(user);
    try {
      return await this.websiteService.editWebsite(
        websiteId,
        userId,
        this.scopedEditPrompt(editDto),
        editDto.framework,
        editDto.attachments,
        editDto.displayEditPrompt,
      );
    } catch (error: any) {
      const message = error?.message || 'Unknown error during edit';
      const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      console.error('WebsiteController.editWebsite - Error:', message, error?.stack);
      throw new HttpException(
        { message, statusCode: status, error: 'Website edit failed' },
        status,
        { cause: error },
      );
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getWebsite(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = this.userIdFromRequest(user);
    return this.websiteService.getWebsiteById(id, userId);
  }

  @Post(':id/rebuild-preview')
  @UseGuards(JwtAuthGuard)
  async rebuildPreview(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = this.userIdFromRequest(user);
    try {
      return await this.websiteService.rebuildReactPreview(id, userId);
    } catch (error: any) {
      const message = error?.message || 'Unknown error during rebuild';
      const status = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(
        { message, statusCode: status, error: 'Preview rebuild failed' },
        status,
        { cause: error },
      );
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteWebsite(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = this.userIdFromRequest(user);
    return this.websiteService.deleteWebsite(id, userId);
  }
}
