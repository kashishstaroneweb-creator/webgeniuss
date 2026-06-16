// ╔════════════════════════════════════════════════════════════════════════════╗
// ║                  ✨ WebGenius Auth Service ✨                              ║
// ║               Dark Purple × Neon Cyberpunk Theme                          ║
// ╚════════════════════════════════════════════════════════════════════════════╝

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, OAuthProvider, SubscriptionPlanType } from '../entities/user.entity';
import { Role, RoleName } from '../entities/role.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';

import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

type OtpPurpose = 'signup' | 'login' | 'password_reset';

@Injectable()
export class AuthService {
  private transporter: nodemailer.Transporter;
  private readonly otpExpiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(CreditLedger)
    private creditLedgerRepository: Repository<CreditLedger>,
    private jwtService: JwtService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // ─── Utility: Get User ID Safely ─────────────────────────────────────
  private getUserIdString(user: User): string {
    const userId = (user as any)._id || (user as any).id;
    if (!userId) {
      throw new Error('User ID not found');
    }
    return userId.toString ? userId.toString() : String(userId);
  }

  // ─── Sanitize User (Remove Sensitive Fields) ─────────────────────────
  private sanitizeUser(user: User) {
    const {
      password,
      otpCode,
      otpExpiresAt,
      otpSessionToken,
      otpPurpose,
      ...rest
    } = user as any;

    return {
      ...rest,
      id: this.getUserIdString(user),
      creditsBalance: Number((user as any).creditsBalance ?? 0),
      creditsUsed: Number((user as any).creditsUsed ?? 0),
      accountStatus: (user as any).accountStatus || 'active',
    };
  }

  // ─── Generate Secure 6-Digit OTP ─────────────────────────────────────
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async recordInitialCreditGrant(user: User, reason: string) {
    const userId = this.getUserIdString(user);
    const amount = Number((user as any).creditsBalance || 0);
    if (amount <= 0) return;
    await this.creditLedgerRepository.save(
      this.creditLedgerRepository.create({
        userId,
        type: 'subscription_grant',
        amount,
        balanceBefore: 0,
        balanceAfter: amount,
        reason,
        createdBy: 'system',
      }),
    );
  }

  // ─── Send OTP Email (black & green theme to match WebGenius) ───────────
  private async sendOtpEmail(email: string, otp: string, purpose: OtpPurpose) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('SMTP credentials are not configured.');
      throw new InternalServerErrorException('Email service is not configured');
    }

    const purposeTitle =
      purpose === 'signup'
        ? 'Account Verification'
        : purpose === 'password_reset'
          ? 'Password reset'
          : 'Login Verification';

    const subject =
      purpose === 'signup'
        ? 'Verify your WebGenius account'
        : purpose === 'password_reset'
          ? 'Reset your WebGenius password'
          : 'Your WebGenius login verification code';

    const html = `
      <div style="
        font-family: 'Segoe UI', Arial, sans-serif;
        background: linear-gradient(135deg, #0a0a0a 0%, #0d1117 50%, #0d1a12 100%);
        color: #e5e7eb;
        padding: 40px 20px;
        border-radius: 16px;
        max-width: 500px;
        margin: 20px auto;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 0 20px rgba(34, 197, 94, 0.08);
        border: 1px solid #22c55e;
      ">
        <h2 style="
          color: #22c55e;
          text-align: center;
          font-size: 28px;
          margin-bottom: 10px;
        ">
          WebGenius ${purposeTitle}
        </h2>

        <p style="text-align: center; font-size: 16px; opacity: 0.95; color: #d1d5db;">
          Your One-Time Password (OTP) is:
        </p>

        <div style="
          text-align: center;
          margin: 30px 0;
          padding: 20px;
          background: rgba(34, 197, 94, 0.08);
          border-radius: 12px;
          border: 2px dashed #22c55e;
        ">
          <span style="
            font-size: 42px;
            font-weight: bold;
            letter-spacing: 12px;
            color: #22c55e;
          ">${otp}</span>
        </div>

        <p style="text-align: center; color: #9ca3af;">
          This code expires in <strong style="color: #22c55e;">${this.otpExpiryMinutes} minutes</strong>.
        </p>

        <p style="
          text-align: center;
          font-size: 14px;
          color: #6b7280;
          margin-top: 30px;
        ">
          If you didn't request this, please secure your account immediately.
        </p>

        <hr style="border: 0; border-top: 1px solid #22c55e; margin: 30px 0; opacity: 0.5;" />

        <p style="text-align: center; font-size: 13px; color: #6b7280;">
          — With love from the <span style="color: #22c55e;">WebGenius</span> Team
        </p>
      </div>
    `;

    // Send email logic here (await this.transporter.sendMail(...))

    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM || `WebGenius <${process.env.SMTP_USER}>`,
        to: email,
        subject,
        html,
      });
    } catch (error) {
      console.error('Failed to send OTP email', error);
      throw new InternalServerErrorException('Failed to send OTP email');
    }
  }

  private async initiateOtpFlow(user: User, purpose: OtpPurpose) {
    const otp = this.generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + this.otpExpiryMinutes * 60 * 1000);
    const sessionToken = randomUUID();

    user.otpCode = hashedOtp;
    user.otpExpiresAt = expiresAt;
    user.otpSessionToken = sessionToken;
    user.otpPurpose = purpose;

    await this.userRepository.save(user);
    await this.sendOtpEmail(user.email, otp, purpose);

    return {
      sessionToken,
      expiresAt,
    };
  }

  async signUp(signUpDto: SignUpDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: signUpDto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(signUpDto.password, 10);
    
    // Get default user role
    let userRole = await this.roleRepository.findOne({
      where: { name: RoleName.USER },
    });

    if (!userRole) {
      userRole = this.roleRepository.create({
        name: RoleName.USER,
        permissions: ['read:own', 'write:own'],
      });
      await this.roleRepository.save(userRole);
    }

    const user = this.userRepository.create({
      ...signUpDto,
      password: hashedPassword,
      oauthProvider: OAuthProvider.LOCAL,
      subscriptionPlan: SubscriptionPlanType.FREE,
      isOtpVerified: false,
      roleId: ((userRole as any)._id?.toString() || (userRole as any).id?.toString()),
      creditsBalance: Number(process.env.DEFAULT_USER_CREDITS) || 5,
      creditsUsed: 0,
      accountStatus: 'active',
    });

    const savedUser = await this.userRepository.save(user);
    await this.recordInitialCreditGrant(savedUser, 'Default free signup credits');
    
    const userIdString = this.getUserIdString(savedUser);
    console.log('SignUp - User created, ID:', userIdString);

    const otpDetails = await this.initiateOtpFlow(savedUser, 'signup');

    return {
      otpRequired: true,
      email: savedUser.email,
      userId: userIdString,
      otpSession: otpDetails.sessionToken,
      expiresAt: otpDetails.expiresAt,
      message: 'OTP sent to your email. Please verify to complete signup.',
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userIdString = this.getUserIdString(user);
    console.log('Login - User authenticated, ID:', userIdString);

    const role = user.roleId
      ? await this.roleRepository.findOne({ where: { _id: new ObjectId(user.roleId) } as any })
      : null;
    const isSuperAdmin = role?.name === RoleName.SUPERADMIN;
    const bypassAdminOtp = process.env.SUPER_ADMIN_BYPASS_OTP !== 'false';
    if (isSuperAdmin && bypassAdminOtp) {
      user.isOtpVerified = true;
      user.otpCode = null;
      user.otpExpiresAt = null;
      user.otpSessionToken = null;
      user.otpPurpose = null;
      await this.userRepository.save(user);
      const sanitizedUser = { ...this.sanitizeUser(user), roleName: role.name };
      return {
        user: sanitizedUser,
        access_token: this.jwtService.sign({
          sub: userIdString,
          email: user.email,
        }),
      };
    }

    const otpDetails = await this.initiateOtpFlow(user, 'login');

    return {
      otpRequired: true,
      email: user.email,
      userId: userIdString,
      otpSession: otpDetails.sessionToken,
      expiresAt: otpDetails.expiresAt,
      message: 'OTP sent to your email. Enter it to finish logging in.',
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (user?.password) {
      const otpDetails = await this.initiateOtpFlow(user, 'password_reset');
      return {
        message: 'Verification code sent. Enter it below with your new password.',
        otpRequired: true,
        email: user.email,
        otpSession: otpDetails.sessionToken,
        expiresAt: otpDetails.expiresAt,
      };
    }

    return {
      message:
        'If an account exists with this email, you will receive a verification code shortly.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid or expired reset session');
    }

    if (user.otpPurpose !== 'password_reset') {
      throw new UnauthorizedException('Invalid or expired reset session');
    }

    if (!user.otpCode || !user.otpSessionToken) {
      throw new UnauthorizedException('Invalid or expired reset session');
    }

    if (user.otpSessionToken !== dto.sessionToken) {
      throw new UnauthorizedException('Invalid or expired reset session');
    }

    if (!user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP has expired');
    }

    const isOtpValid = await bcrypt.compare(dto.otp, user.otpCode);
    if (!isOtpValid) {
      throw new UnauthorizedException('Invalid OTP');
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    user.otpCode = null;
    user.otpExpiresAt = null;
    user.otpSessionToken = null;
    user.otpPurpose = null;
    user.isOtpVerified = true;

    await this.userRepository.save(user);

    const role = user.roleId
      ? await this.roleRepository.findOne({ where: { _id: new ObjectId(user.roleId) } as any })
      : null;
    const sanitizedUser = { ...this.sanitizeUser(user), roleName: role?.name || RoleName.USER };
    const accessToken = this.jwtService.sign({
      sub: sanitizedUser.id,
      email: user.email,
    });

    return {
      user: sanitizedUser,
      access_token: accessToken,
      message: 'Password updated successfully.',
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const user = await this.userRepository.findOne({
      where: { email: verifyOtpDto.email },
    });

    if (!user || !user.otpCode || !user.otpSessionToken) {
      throw new UnauthorizedException('Invalid OTP session');
    }

    if (user.otpSessionToken !== verifyOtpDto.sessionToken) {
      throw new UnauthorizedException('Invalid OTP session');
    }

    if (user.otpPurpose === 'password_reset') {
      throw new UnauthorizedException(
        'This code is for password reset. Complete reset on the forgot-password page.',
      );
    }

    if (!user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP has expired');
    }

    const isOtpValid = await bcrypt.compare(verifyOtpDto.otp, user.otpCode);
    if (!isOtpValid) {
      throw new UnauthorizedException('Invalid OTP');
    }

    user.otpCode = null;
    user.otpExpiresAt = null;
    user.otpSessionToken = null;
    user.otpPurpose = null;
    user.isOtpVerified = true;

    await this.userRepository.save(user);

    const role = user.roleId
      ? await this.roleRepository.findOne({ where: { _id: new ObjectId(user.roleId) } as any })
      : null;
    const sanitizedUser = { ...this.sanitizeUser(user), roleName: role?.name || RoleName.USER };
    const accessToken = this.jwtService.sign({
      sub: sanitizedUser.id,
      email: user.email,
    });

    return {
      user: sanitizedUser,
      access_token: accessToken,
    };
  }

  async validateOAuthUser(userData: {
    email: string;
    name: string;
    oauthId: string;
    oauthProvider: OAuthProvider;
  }) {
    let user = await this.userRepository.findOne({
      where: { email: userData.email },
    });

    if (!user) {
      // Get default user role
      let userRole = await this.roleRepository.findOne({
        where: { name: RoleName.USER },
      });

      if (!userRole) {
        userRole = this.roleRepository.create({
          name: RoleName.USER,
          permissions: ['read:own', 'write:own'],
        });
        await this.roleRepository.save(userRole);
      }

      user = this.userRepository.create({
        email: userData.email,
        name: userData.name,
        oauthProvider: userData.oauthProvider,
        oauthId: userData.oauthId,
        isOtpVerified: true,
        subscriptionPlan: SubscriptionPlanType.FREE,
        roleId: ((userRole as any)._id?.toString() || (userRole as any).id?.toString()),
        creditsBalance: Number(process.env.DEFAULT_USER_CREDITS) || 5,
        creditsUsed: 0,
        accountStatus: 'active',
      });
      await this.userRepository.save(user);
      await this.recordInitialCreditGrant(user, 'Default OAuth signup credits');
    } else if (!user.oauthId) {
      // Link OAuth account to existing user
      user.oauthId = userData.oauthId;
      user.oauthProvider = userData.oauthProvider;
      user.isOtpVerified = true;
      await this.userRepository.save(user);
    }

    const userIdString = this.getUserIdString(user);
    console.log('validateOAuthUser - User validated, ID:', userIdString);

    const { password, otpCode, otpExpiresAt, otpSessionToken, ...result } = user as any;
    return {
      user: { ...result, id: userIdString },
      access_token: this.jwtService.sign({ 
        sub: userIdString, 
        email: user.email 
      }),
    };
  }
}

