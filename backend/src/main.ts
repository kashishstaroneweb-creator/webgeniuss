import './load-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as dns from 'dns';
import { AppModule } from './app.module';

// Prefer IPv4 on Windows when resolving hostnames (pairs with https.Agent family:4 in WebsiteService for v0 API).
if (process.platform === 'win32' && process.env.V0_DNS_IPV4_FIRST !== '0') {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // v0 generation can take a while for complex prompts; keep HTTP connections open longer.
  app.getHttpServer().setTimeout(300000);
  console.log(`🚀 WebGenius API is running on: http://localhost:${port}`);
}

bootstrap();

