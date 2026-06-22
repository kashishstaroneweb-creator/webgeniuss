import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { GenerationUsage } from '../entities/generation-usage.entity';
import { Role, RoleName } from '../entities/role.entity';
import { OAuthProvider, SubscriptionPlanType, User } from '../entities/user.entity';
import { Website } from '../entities/website.entity';
import { WebsiteTemplate } from '../entities/website-template.entity';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';
import { CreateTemplateFromWebsiteDto } from './dto/create-template-from-website.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Website)
    private websiteRepository: Repository<Website>,
    @InjectRepository(WebsiteTemplate)
    private templateRepository: Repository<WebsiteTemplate>,
    @InjectRepository(CreditLedger)
    private creditLedgerRepository: Repository<CreditLedger>,
    @InjectRepository(GenerationUsage)
    private generationUsageRepository: Repository<GenerationUsage>,
  ) {}

  async onModuleInit() {
    await this.seedSuperAdmin();
  }

  private objectIdString(entity: any): string {
    return (entity?._id || entity?.id)?.toString();
  }

  private async getOrCreateRole(name: RoleName, permissions: string[]) {
    let role = await this.roleRepository.findOne({ where: { name } });
    if (!role) {
      role = this.roleRepository.create({ name, permissions });
      role = await this.roleRepository.save(role);
    }
    return role;
  }

  async seedSuperAdmin() {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@webgenius.local';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345';

    const userRole = await this.getOrCreateRole(RoleName.USER, ['read:own', 'write:own']);
    await this.getOrCreateRole(RoleName.ADMIN, [
      'read:all',
      'write:all',
      'delete:all',
      'manage:subscriptions',
      'manage:users',
    ]);
    const superAdminRole = await this.getOrCreateRole(RoleName.SUPERADMIN, [
      'read:all',
      'write:all',
      'delete:all',
      'manage:subscriptions',
      'manage:users',
      'manage:roles',
      'manage:system',
    ]);

    const defaultCredits = Number(process.env.DEFAULT_USER_CREDITS) || 5;
    await (this.userRepository as any).updateMany(
      {
        $or: [
          { creditsBalance: { $exists: false } },
          { creditsUsed: { $exists: false } },
          { accountStatus: { $exists: false } },
        ],
      } as any,
      {
        $set: {
          creditsBalance: defaultCredits,
          creditsUsed: 0,
          accountStatus: 'active',
        },
      } as any,
    );

    const existing = await this.userRepository.findOne({ where: { email: superAdminEmail } });
    if (existing) {
      existing.roleId = this.objectIdString(superAdminRole);
      existing.isOtpVerified = true;
      existing.accountStatus = existing.accountStatus || 'active';
      existing.creditsBalance = Number(existing.creditsBalance ?? 100000);
      existing.creditsUsed = Number(existing.creditsUsed ?? 0);
      await this.userRepository.save(existing);
      return;
    }

    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);
    const admin = this.userRepository.create({
      name: process.env.SUPER_ADMIN_NAME || 'WebGenius Admin',
      email: superAdminEmail,
      password: hashedPassword,
      oauthProvider: OAuthProvider.LOCAL,
      subscriptionPlan: SubscriptionPlanType.ENTERPRISE,
      isOtpVerified: true,
      roleId: this.objectIdString(superAdminRole || userRole),
      creditsBalance: Number(process.env.SUPER_ADMIN_INITIAL_CREDITS) || 100000,
      creditsUsed: 0,
      accountStatus: 'active',
      themePreference: 'dark',
    });
    const saved = await this.userRepository.save(admin);
    await this.creditLedgerRepository.save(
      this.creditLedgerRepository.create({
        userId: this.objectIdString(saved),
        type: 'subscription_grant',
        amount: saved.creditsBalance,
        balanceBefore: 0,
        balanceAfter: saved.creditsBalance,
        reason: 'Initial super admin credits seeded',
        createdBy: 'system',
      }),
    );
  }

  private async roleNameFor(roleId?: string) {
    if (!roleId) return RoleName.USER;
    try {
      const role = await this.roleRepository.findOne({ where: { _id: new ObjectId(roleId) } as any });
      return role?.name || RoleName.USER;
    } catch {
      return RoleName.USER;
    }
  }

  private sanitizeUser(user: User, roleName?: RoleName) {
    const { password, otpCode, otpExpiresAt, otpSessionToken, otpPurpose, ...rest } = user as any;
    return {
      ...rest,
      id: this.objectIdString(user),
      roleName,
      creditsBalance: Number(user.creditsBalance ?? 0),
      creditsUsed: Number(user.creditsUsed ?? 0),
      accountStatus: user.accountStatus || 'active',
    };
  }

  private slugify(value: string) {
    return (value || 'template')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `template-${Date.now()}`;
  }

  private serializeTemplate(template: WebsiteTemplate) {
    return {
      ...template,
      id: this.objectIdString(template),
    };
  }

  async getDashboard() {
    const [users, websites, generations, ledger] = await Promise.all([
      this.userRepository.find(),
      this.websiteRepository.find(),
      this.generationUsageRepository.find(),
      this.creditLedgerRepository.find(),
    ]);

    const success = generations.filter((item) => item.status === 'success');
    const failed = generations.filter((item) => item.status === 'failed');
    const started = generations.filter((item) => item.status === 'started');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayGenerations = generations.filter((item) => new Date(item.startedAt || item.updatedAt).getTime() >= todayStart.getTime());
    const creditsConsumed = success.reduce((sum, item) => sum + Number(item.actualCostCredits || 0), 0);
    const creditsGranted = ledger
      .filter((item) => item.amount > 0)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const adminAdjustments = ledger
      .filter((item) => item.type === 'admin_adjustment')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const subscriptionGrants = ledger
      .filter((item) => item.type === 'subscription_grant')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const imageGenerations = generations.filter((item) => item.imageAttached).length;
    const durations = success.map((item) => Number(item.durationMs || 0)).filter(Boolean);
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0;

    const byFramework = generations.reduce<Record<string, number>>((acc, item) => {
      const key = item.framework || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      totals: {
        users: users.length,
        activeUsers: users.filter((user) => (user.accountStatus || 'active') === 'active').length,
        websites: websites.length,
        generations: generations.length,
        todayGenerations: todayGenerations.length,
        successfulGenerations: success.length,
        failedGenerations: failed.length,
        inProgressGenerations: started.length,
        successRate: generations.length ? Math.round((success.length / generations.length) * 100) : 100,
        creditsConsumed,
        creditsGranted,
        adminAdjustments,
        subscriptionGrants,
        netCredits: creditsGranted - creditsConsumed,
        remainingUserCredits: users.reduce((sum, user) => sum + Number(user.creditsBalance || 0), 0),
        imageGenerations,
        avgDurationMs,
      },
      byFramework,
      byStatus: {
        success: success.length,
        failed: failed.length,
        started: started.length,
      },
      byKind: generations.reduce<Record<string, number>>((acc, item) => {
        acc[item.kind] = (acc[item.kind] || 0) + 1;
        return acc;
      }, {}),
      recentGenerations: generations
        .slice()
        .sort((a, b) => new Date(b.startedAt || b.updatedAt).getTime() - new Date(a.startedAt || a.updatedAt).getTime())
        .slice(0, 8),
      topUsers: users
        .slice()
        .sort((a, b) => Number(b.creditsUsed || 0) - Number(a.creditsUsed || 0))
        .slice(0, 8)
        .map((user) => this.sanitizeUser(user)),
      recentLedger: ledger
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8),
    };
  }

  async listUsers() {
    const users = await this.userRepository.find({ order: { createdAt: 'DESC' } as any });
    return Promise.all(users.map(async (user) => this.sanitizeUser(user, await this.roleNameFor(user.roleId))));
  }

  async listGenerations() {
    const rows = await this.generationUsageRepository.find({ order: { startedAt: 'DESC' } as any });
    return rows.map((item) => ({ ...item, id: this.objectIdString(item) }));
  }

  async listLedger(userId?: string) {
    const where = userId ? ({ userId } as any) : undefined;
    const rows = await this.creditLedgerRepository.find({ where, order: { createdAt: 'DESC' } as any });
    return rows.map((item) => ({ ...item, id: this.objectIdString(item) }));
  }

  async adjustCredits(userId: string, dto: AdjustCreditsDto, adminUserId: string) {
    const user = await this.userRepository.findOne({ where: { _id: new ObjectId(userId) } as any });
    if (!user) {
      throw new Error('User not found');
    }
    const before = Number(user.creditsBalance || 0);
    const after = Math.max(0, before + Number(dto.amount));
    user.creditsBalance = after;
    if (dto.amount < 0) user.creditsUsed = Number(user.creditsUsed || 0) + Math.abs(dto.amount);
    const saved = await this.userRepository.save(user);
    const ledger = await this.creditLedgerRepository.save(
      this.creditLedgerRepository.create({
        userId,
        type: 'admin_adjustment',
        amount: after - before,
        balanceBefore: before,
        balanceAfter: after,
        reason: dto.reason,
        referenceId: dto.referenceId,
        createdBy: adminUserId,
      }),
    );
    return { user: this.sanitizeUser(saved, await this.roleNameFor(saved.roleId)), ledger };
  }

  async listTemplates() {
    const rows = await this.templateRepository.find({ order: { sortOrder: 'ASC', createdAt: 'DESC' } as any });
    return rows.map((template) => this.serializeTemplate(template));
  }

  async createTemplateFromWebsite(websiteId: string, dto: CreateTemplateFromWebsiteDto, adminUserId: string) {
    const website = await this.websiteRepository.findOne({ where: { _id: new ObjectId(websiteId) } as any });
    if (!website) {
      throw new Error('Website not found');
    }

    const status = dto.status || 'draft';
    const template = this.templateRepository.create({
      name: dto.name || website.websiteName || `Template ${Date.now()}`,
      slug: this.slugify(dto.slug || dto.name || website.websiteName || `template-${Date.now()}`),
      description: dto.description,
      category: dto.category || website.framework || 'Website',
      tags: Array.isArray(dto.tags) ? dto.tags : [],
      framework: website.framework || 'react',
      thumbnailUrl: dto.thumbnailUrl,
      sourceWebsiteId: website.id.toString(),
      createdByAdminId: adminUserId,
      prompt: website.prompt,
      basePrompt: dto.basePrompt || website.prompt,
      htmlCode: website.htmlCode || '',
      cssCode: website.cssCode || '',
      jsCode: website.jsCode || '',
      components: website.components,
      viteConfig: website.viteConfig,
      v0DemoUrl: website.v0DemoUrl,
      reactArtifactUrl: website.reactArtifactUrl,
      reactBuildStatus: website.reactBuildStatus,
      reactBuildLog: website.reactBuildLog,
      status,
      isFeatured: !!dto.isFeatured,
      isPremium: !!dto.isPremium,
      sortOrder: Number(dto.sortOrder || 0),
      publishedAt: status === 'published' ? new Date() : undefined,
    });

    const saved = await this.templateRepository.save(template);
    return this.serializeTemplate(saved);
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    const template = await this.templateRepository.findOne({ where: { _id: new ObjectId(id) } as any });
    if (!template) {
      throw new Error('Template not found');
    }
    const nextStatus = dto.status || template.status || 'draft';
    Object.assign(template, {
      ...dto,
      slug: dto.slug ? this.slugify(dto.slug) : template.slug,
      tags: Array.isArray(dto.tags) ? dto.tags : template.tags,
      sortOrder: dto.sortOrder !== undefined ? Number(dto.sortOrder) : template.sortOrder,
      status: nextStatus,
      publishedAt: nextStatus === 'published' && !template.publishedAt ? new Date() : template.publishedAt,
    });
    const saved = await this.templateRepository.save(template);
    return this.serializeTemplate(saved);
  }

  async deleteTemplate(id: string) {
    const template = await this.templateRepository.findOne({ where: { _id: new ObjectId(id) } as any });
    if (!template) {
      throw new Error('Template not found');
    }
    await this.templateRepository.delete({ _id: new ObjectId(id) } as any);
    return { success: true };
  }
}
