import { All, Controller, Param, Post, Get, Req, Res, UseGuards, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BackendRuntimeService } from './backend-runtime.service';

@Controller('fullstack')
export class BackendRuntimeController {
  constructor(private readonly runtimes: BackendRuntimeService) {}

  private userId(user: any): string {
    return user.id || user._id?.toString();
  }

  @Post(':id/backend/start')
  @UseGuards(JwtAuthGuard)
  start(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runtimes.start(id, this.userId(user));
  }

  @Post(':id/backend/stop')
  @UseGuards(JwtAuthGuard)
  stop(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runtimes.stop(id, this.userId(user));
  }

  @Get(':id/backend/status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runtimes.status(id, this.userId(user));
  }

  /** Public preview gateway. Only forwards to an already-started generated backend. */
  @All('runtime/:id/api/*')
  async proxy(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const runtime = this.runtimes.getRuntime(id);
    if (!runtime) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        message: 'Backend preview is stopped. Start it from the WebGenius preview first.',
      });
    }
    const suffix = String((req.params as any)[0] || '');
    try {
      const upstream = await axios.request({
        method: req.method,
        url: `http://127.0.0.1:${runtime.port}/api/${suffix}`,
        params: req.query,
        data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        timeout: Number(process.env.FULLSTACK_PROXY_TIMEOUT_MS) || 15_000,
        validateStatus: () => true,
        headers: { 'content-type': req.get('content-type') || 'application/json' },
      });
      return res.status(upstream.status).set('content-type', upstream.headers['content-type'] || 'application/json').send(upstream.data);
    } catch (error: any) {
      return res.status(HttpStatus.BAD_GATEWAY).json({ message: error?.message || 'Generated backend is unavailable' });
    }
  }
}
