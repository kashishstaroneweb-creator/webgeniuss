import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebsiteService } from './website.service';
import { WebsiteController } from './website.controller';
import { TemplatesController } from './templates.controller';
import { Website } from '../entities/website.entity';
import { WebsiteTemplate } from '../entities/website-template.entity';
import { PromptHistory } from '../entities/prompt-history.entity';
import { ReactPreviewBuildService } from './react-preview-build.service';
import { User } from '../entities/user.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { GenerationUsage } from '../entities/generation-usage.entity';
import { WebsiteDeployment } from '../entities/website-deployment.entity';
import { VercelDeploymentService } from './vercel-deployment.service';
import { VercelDeploymentController } from './vercel-deployment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Website, WebsiteTemplate, PromptHistory, User, CreditLedger, GenerationUsage, WebsiteDeployment])],
  controllers: [WebsiteController, TemplatesController, VercelDeploymentController],
  providers: [WebsiteService, ReactPreviewBuildService, VercelDeploymentService],
  exports: [WebsiteService],
})
export class WebsiteModule {}

