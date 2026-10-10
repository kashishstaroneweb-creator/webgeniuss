import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Website } from '../entities/website.entity';
import { WebsiteModule } from '../website/website.module';
import { BlueprintPromptService } from './blueprint-prompt.service';
import { OpenAIBackendService } from './openai-backend.service';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';
import { FullStackController } from './fullstack.controller';
import { ProjectMergerService } from './project-merger.service';
import { BackendRuntimeService } from './backend-runtime.service';
import { BackendRuntimeController } from './backend-runtime.controller';
import { AppPlannerService } from './app-planner.service';
import { BackendBuilderService } from './backend-builder.service';
import { FrontendBuilderService } from './frontend-builder.service';
import { GenerationValidatorService } from './generation-validator.service';

@Module({
  imports: [TypeOrmModule.forFeature([Website]), WebsiteModule],
  controllers: [FullStackController, BackendRuntimeController],
  providers: [
    OpenAIBackendService,
    BlueprintPromptService,
    ProjectMergerService,
    FullStackCoordinatorService,
    BackendRuntimeService,
    AppPlannerService,
    BackendBuilderService,
    FrontendBuilderService,
    GenerationValidatorService,
  ],
})
export class FullStackModule {}
