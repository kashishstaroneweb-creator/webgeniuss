import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { User, SubscriptionPlanType } from '../entities/user.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private subscriptionPlanRepository: Repository<SubscriptionPlan>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CreditLedger)
    private creditLedgerRepository: Repository<CreditLedger>,
  ) {}

  private creditsForPlan(planType: SubscriptionPlanType): number {
    if (planType === SubscriptionPlanType.ENTERPRISE) return Number(process.env.PLAN_CREDITS_ENTERPRISE) || 1000;
    if (planType === SubscriptionPlanType.PREMIUM) return Number(process.env.PLAN_CREDITS_PREMIUM) || 200;
    if (planType === SubscriptionPlanType.BASIC) return Number(process.env.PLAN_CREDITS_BASIC) || 50;
    return Number(process.env.PLAN_CREDITS_FREE) || Number(process.env.DEFAULT_USER_CREDITS) || 5;
  }

  async getAllPlans() {
    return this.subscriptionPlanRepository.find();
  }

  async upgradePlan(userId: string, planType: SubscriptionPlanType) {
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) } as any,
    });
    if (!user) {
      throw new Error('User not found');
    }
    const before = Number(user.creditsBalance || 0);
    const grant = this.creditsForPlan(planType);
    user.subscriptionPlan = planType;
    user.creditsBalance = before + grant;
    const saved = await this.userRepository.save(user);
    await this.creditLedgerRepository.save(
      this.creditLedgerRepository.create({
        userId,
        type: 'subscription_grant',
        amount: grant,
        balanceBefore: before,
        balanceAfter: before + grant,
        reason: `${planType} subscription credit grant`,
        createdBy: 'system',
      }),
    );
    return saved;
  }

  async initializeDefaultPlans() {
    const plans = [
      {
        name: 'Free',
        price: 0,
        features: [`${this.creditsForPlan(SubscriptionPlanType.FREE)} credits`, 'Basic AI responses', 'Community support'],
      },
      {
        name: 'Basic',
        price: 9.99,
        features: [`${this.creditsForPlan(SubscriptionPlanType.BASIC)} credits`, 'Advanced AI responses', 'Email support', 'Priority queue'],
      },
      {
        name: 'Premium',
        price: 29.99,
        features: [`${this.creditsForPlan(SubscriptionPlanType.PREMIUM)} credits`, 'Premium AI responses', '24/7 support', 'API access', 'Custom integrations'],
      },
      {
        name: 'Enterprise',
        price: 99.99,
        features: [`${this.creditsForPlan(SubscriptionPlanType.ENTERPRISE)} credits`, 'Dedicated support', 'Custom AI models', 'SLA guarantee', 'On-premise deployment'],
      },
    ];

    for (const planData of plans) {
      const existingPlan = await this.subscriptionPlanRepository.findOne({
        where: { name: planData.name },
      });
      if (!existingPlan) {
        const plan = this.subscriptionPlanRepository.create(planData);
        await this.subscriptionPlanRepository.save(plan);
      }
    }
  }
}

