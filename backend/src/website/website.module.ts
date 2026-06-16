import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebsiteService } from './website.service';
import { WebsiteController } from './website.controller';
import { Website } from '../entities/website.entity';
import { PromptHistory } from '../entities/prompt-history.entity';
import { ReactPreviewBuildService } from './react-preview-build.service';
import { User } from '../entities/user.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { GenerationUsage } from '../entities/generation-usage.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Website, PromptHistory, User, CreditLedger, GenerationUsage])],
  controllers: [WebsiteController],
  providers: [WebsiteService, ReactPreviewBuildService],
  exports: [WebsiteService],
})
export class WebsiteModule {}

