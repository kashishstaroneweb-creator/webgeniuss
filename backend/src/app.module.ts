import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PromptModule } from './prompt/prompt.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { WebsiteModule } from './website/website.module';
import { RoleModule } from './role/role.module';
import { AdminModule } from './admin/admin.module';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { FullStackModule } from './fullstack/fullstack.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot({
      type: 'mongodb',
      url: process.env.MONGODB_URI,
      synchronize: true,
      autoLoadEntities: true,
      // MongoDB Atlas uses SSL automatically with mongodb+srv:// protocol
      // No additional SSL configuration needed
    }),
    AuthModule,
    UserModule,
    PromptModule,
    SubscriptionModule,
    WebsiteModule,
    RoleModule,
    AdminModule,
    FullStackModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggingMiddleware)
      .forRoutes('*');
  }
}

