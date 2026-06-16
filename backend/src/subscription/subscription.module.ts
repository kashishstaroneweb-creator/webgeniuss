import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { User } from '../entities/user.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionPlan, User, CreditLedger])],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule implements OnModuleInit {
  constructor(private subscriptionService: SubscriptionService) {}

  async onModuleInit() {
    await this.subscriptionService.initializeDefaultPlans();
  }
}

