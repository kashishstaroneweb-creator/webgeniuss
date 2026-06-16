import { Entity, Column, ObjectIdColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ObjectId } from 'mongodb';
import { PromptHistory } from './prompt-history.entity';
import { Website } from './website.entity';

export enum OAuthProvider {
  GOOGLE = 'google',
  GITHUB = 'github',
  LOCAL = 'local',
}

export enum SubscriptionPlanType {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

@Entity('users')
export class User {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password?: string;

  @Column({
    type: 'enum',
    enum: OAuthProvider,
    default: OAuthProvider.LOCAL,
  })
  oauthProvider: OAuthProvider;

  @Column({ nullable: true })
  oauthId?: string;

  @Column({ nullable: true })
  otpCode?: string;

  @Column({ nullable: true })
  otpExpiresAt?: Date;

  @Column({ nullable: true })
  otpSessionToken?: string;

  @Column({ nullable: true })
  otpPurpose?: string;

  @Column({ default: false })
  isOtpVerified: boolean;

  @Column({
    type: 'enum',
    enum: SubscriptionPlanType,
    default: SubscriptionPlanType.FREE,
  })
  subscriptionPlan: SubscriptionPlanType;

  @Column({ default: 5 })
  creditsBalance: number;

  @Column({ default: 0 })
  creditsUsed: number;

  @Column({ default: 'active' })
  accountStatus: 'active' | 'suspended';

  @Column({ nullable: true })
  roleId?: string;

  @Column({ default: 'light' })
  themePreference: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PromptHistory, (prompt) => prompt.user)
  prompts: PromptHistory[];

  @OneToMany(() => Website, (website) => website.user)
  websites: Website[];
}

