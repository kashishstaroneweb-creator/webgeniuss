import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Website } from '../entities/website.entity';
import { WebsiteModule } from '../website/website.module';
import { BlueprintPromptService } from './blueprint-prompt.service';
import { ClaudeBackendService } from './claude-backend.service';
import { FullStackCoordinatorService } from './fullstack-coordinator.service';
import { FullStackController } from './fullstack.controller';
import { ProjectMergerService } from './project-merger.service';
import { BackendRuntimeService } from './backend-runtime.service';
import { BackendRuntimeController } from './backend-runtime.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Website]), WebsiteModule],
  controllers: [FullStackController, BackendRuntimeController],
  providers: [ClaudeBackendService, BlueprintPromptService, ProjectMergerService, FullStackCoordinatorService, BackendRuntimeService],
})
export class FullStackModule {}
