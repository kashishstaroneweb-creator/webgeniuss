import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerateFullStackDto } from './dto/generate-fullstack.dto';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';
import { OpenAIBackendService } from './openai-backend.service';
import { BackendRuntimeService } from './backend-runtime.service';
import { ObjectId } from 'mongodb';

@Controller('fullstack')
export class FullStackController {
  private readonly logger = new Logger(FullStackController.name);

  constructor(
    private readonly coordinator: FullStackCoordinatorService,
    private readonly openAIBackend: OpenAIBackendService,
    private readonly backendRuntime: BackendRuntimeService,
  ) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generate(@CurrentUser() user: any, @Body() dto: GenerateFullStackDto) {
    const userId = user.id || user._id?.toString();
    this.logger.log(`Full-stack generation requested by ${userId} for "${dto.websiteName || 'Untitled'}" in mode "${dto.mode || 'production-app'}"`);
    return this.coordinator.generate(userId, dto.prompt, dto.websiteName, dto.mode || 'production-app');
  }

  @Post('backend-plan')
  async backendPlan(@Body() dto: GenerateFullStackDto) {
    const websiteName = dto.websiteName?.trim() || `Backend ${Date.now()}`;
    this.logger.log(`Remote backend-plan requested for "${websiteName}"`);
    try {
      const plan = await this.openAIBackend.generateDirect(dto.prompt, websiteName);
      const runtime = await this.backendRuntime.deploy(new ObjectId().toString(), plan.backendFiles);
      const runtimeId = runtime.id.toString();
      this.logger.log(`Remote backend-plan ready for "${websiteName}" with runtime ${runtimeId}`);
      return {
        ...plan,
        runtimeId,
        backendStatus: runtime.backendStatus,
        backendLogs: runtime.backendLogs,
        backendPreviewUrl: runtime.backendPreviewUrl,
      };
    } catch (error: any) {
      this.logger.error(
        `Remote backend-plan failed for "${websiteName}": ${error?.message || String(error)}`,
        error?.stack,
      );
      throw error;
    }
  }

}
