import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerateFullStackDto } from './dto/generate-fullstack.dto';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';
import { OpenAIBackendService } from './openai-backend.service';
import { BackendRuntimeService } from './backend-runtime.service';
import { ObjectId } from 'mongodb';

@Controller('fullstack')
export class FullStackController {
  constructor(
    private readonly coordinator: FullStackCoordinatorService,
    private readonly openAIBackend: OpenAIBackendService,
    private readonly backendRuntime: BackendRuntimeService,
  ) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generate(@CurrentUser() user: any, @Body() dto: GenerateFullStackDto) {
    return this.coordinator.generate(user.id || user._id?.toString(), dto.prompt, dto.websiteName);
  }

  @Post('backend-plan')
  async backendPlan(@Body() dto: GenerateFullStackDto) {
    const plan = await this.openAIBackend.generateDirect(
      dto.prompt,
      dto.websiteName?.trim() || `Backend ${Date.now()}`,
    );
    const runtimeId = new ObjectId().toString();
    const runtime = await this.backendRuntime.deploy(runtimeId, plan.backendFiles);
    return {
      ...plan,
      runtimeId,
      backendStatus: runtime.backendStatus,
      backendLogs: runtime.backendLogs,
      backendPreviewUrl: runtime.backendPreviewUrl,
    };
  }

}
