import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { GenerationUsage } from '../entities/generation-usage.entity';
import { Role } from '../entities/role.entity';
import { User } from '../entities/user.entity';
import { Website } from '../entities/website.entity';
import { WebsiteTemplate } from '../entities/website-template.entity';
import { UserModule } from '../user/user.module';
import { WebsiteModule } from '../website/website.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Website, WebsiteTemplate, CreditLedger, GenerationUsage]),
    UserModule,
    WebsiteModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
