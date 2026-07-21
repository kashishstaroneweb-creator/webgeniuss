import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import { ObjectId } from 'mongodb';
import * as path from 'path';
import { Repository } from 'typeorm';
import { Website } from '../entities/website.entity';

interface RunningBackend {
  child: ChildProcessWithoutNullStreams;
  port: number;
  logs: string;
  lastRequestAt: number;
}

@Injectable()
export class BackendRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly running = new Map<string, RunningBackend>();
  private readonly starting = new Map<string, Promise<Website>>();
  private readonly runtimeRoot = path.resolve(process.env.FULLSTACK_RUNTIME_ROOT || path.join(process.cwd(), '.fullstack-runtimes'));
  private readonly portStart = Number(process.env.FULLSTACK_PORT_START) || 4100;
  private readonly portEnd = Number(process.env.FULLSTACK_PORT_END) || 4199;
  private readonly maxActive = Number(process.env.FULLSTACK_MAX_ACTIVE) || (process.env.RENDER === 'true' ? 2 : 5);
  private readonly idleTimeoutMs = Number(process.env.FULLSTACK_IDLE_TIMEOUT_MS) || 15 * 60_000;
  private idleTimer?: NodeJS.Timeout;

  constructor(@InjectRepository(Website) private readonly websites: Repository<Website>) {}

  onModuleInit(): void {
    this.idleTimer = setInterval(() => void this.stopIdleRuntimes(), Math.min(60_000, this.idleTimeoutMs));
    this.idleTimer.unref();
  }

  async start(websiteId: string, userId: string): Promise<Website> {
    const existing = this.starting.get(websiteId);
    if (existing) return existing;
    const operation = this.startInternal(websiteId, userId).finally(() => this.starting.delete(websiteId));
    this.starting.set(websiteId, operation);
    return operation;
  }

  private async startInternal(websiteId: string, userId: string): Promise<Website> {
    const website = await this.findOwned(websiteId, userId);
    const active = this.running.get(websiteId);
    if (active && !active.child.killed) return website;
    if (!website.backendFiles?.length) throw new BadRequestException('This project has no generated backend');
    if (this.running.size >= this.maxActive) {
      throw new BadRequestException(`The MVP backend limit of ${this.maxActive} active projects has been reached`);
    }

    const port = this.allocatePort();
    const workspace = this.workspaceFor(websiteId);
    await fs.promises.mkdir(workspace, { recursive: true });
    for (const file of website.backendFiles) {
      const target = path.resolve(workspace, file.path);
      if (!target.startsWith(workspace + path.sep)) throw new BadRequestException('Invalid generated backend path');
      if (file.path === 'data.json' && fs.existsSync(target)) continue;
      await fs.promises.writeFile(target, file.content, 'utf8');
    }

    website.backendStatus = 'installing';
    website.backendPort = port;
    website.backendLogs = 'Installing approved backend dependencies...';
    await this.websites.save(website);

    try {
      const installLogs = await this.runInstall(workspace);
      const child = spawn(process.execPath, ['server.js'], {
        cwd: workspace,
        shell: false,
        windowsHide: true,
        env: this.runtimeEnvironment(port),
      });
      const runtime: RunningBackend = { child, port, logs: installLogs, lastRequestAt: Date.now() };
      this.running.set(websiteId, runtime);
      this.captureLogs(websiteId, runtime);

      await this.waitForHealth(port, child);
      website.backendStatus = 'running';
      website.backendPort = port;
      website.backendProcessId = child.pid;
      website.backendPreviewUrl = `/fullstack/runtime/${websiteId}`;
      website.backendLogs = runtime.logs.slice(-60_000);
      return await this.websites.save(website);
    } catch (error: any) {
      const runtime = this.running.get(websiteId);
      if (runtime) this.terminate(runtime.child);
      this.running.delete(websiteId);
      website.backendStatus = 'failed';
      website.backendLogs = `${website.backendLogs || ''}\n${error?.message || String(error)}`.slice(-60_000);
      await this.websites.save(website);
      throw error;
    }
  }

  async stop(websiteId: string, userId: string): Promise<Website> {
    const website = await this.findOwned(websiteId, userId);
    const runtime = this.running.get(websiteId);
    if (runtime) {
      this.terminate(runtime.child);
      website.backendLogs = runtime.logs.slice(-60_000);
      this.running.delete(websiteId);
    }
    website.backendStatus = 'stopped';
    website.backendProcessId = undefined;
    website.backendPort = undefined;
    return this.websites.save(website);
  }

  async status(websiteId: string, userId: string): Promise<Partial<Website>> {
    const website = await this.findOwned(websiteId, userId);
    const runtime = this.running.get(websiteId);
    return {
      id: website.id,
      backendStatus: runtime
        ? 'running'
        : website.backendStatus === 'running' || website.backendStatus === 'installing'
          ? 'stopped'
          : website.backendStatus,
      backendPort: runtime?.port,
      backendProcessId: runtime?.child.pid,
      backendPreviewUrl: website.backendPreviewUrl,
      backendLogs: runtime?.logs.slice(-60_000) || website.backendLogs,
    };
  }

  getRuntime(websiteId: string): RunningBackend | undefined {
    const runtime = this.running.get(websiteId);
    if (runtime) runtime.lastRequestAt = Date.now();
    return runtime;
  }

  onModuleDestroy(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const runtime of this.running.values()) this.terminate(runtime.child);
    this.running.clear();
  }

  private async findOwned(websiteId: string, userId: string): Promise<Website> {
    if (!ObjectId.isValid(websiteId)) throw new NotFoundException('Project not found');
    const website = await this.websites.findOne({ where: { _id: new ObjectId(websiteId), userId } as any });
    if (!website) throw new NotFoundException('Project not found');
    return website;
  }

  private workspaceFor(websiteId: string): string {
    if (!ObjectId.isValid(websiteId)) throw new BadRequestException('Invalid project id');
    const workspace = path.resolve(this.runtimeRoot, websiteId);
    if (!workspace.startsWith(this.runtimeRoot + path.sep)) throw new BadRequestException('Invalid runtime workspace');
    return workspace;
  }

  private allocatePort(): number {
    const used = new Set(Array.from(this.running.values()).map((runtime) => runtime.port));
    for (let port = this.portStart; port <= this.portEnd; port++) if (!used.has(port)) return port;
    throw new BadRequestException('No backend preview ports are available');
  }

  private runInstall(workspace: string): Promise<string> {
    if (process.env.FULLSTACK_SHARED_DEPENDENCIES === '1') {
      return Promise.resolve('Using dependencies from the WebGenius Render service.\n');
    }
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return new Promise((resolve, reject) => {
      const child = spawn(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: workspace,
        shell: false,
        windowsHide: true,
        env: process.env,
      });
      let logs = '';
      const append = (data: Buffer) => (logs = (logs + data.toString()).slice(-60_000));
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      const timer = setTimeout(() => {
        this.terminate(child as ChildProcessWithoutNullStreams);
        reject(new Error('Backend dependency installation timed out'));
      }, Number(process.env.FULLSTACK_INSTALL_TIMEOUT_MS) || 120_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(logs) : reject(new Error(`Backend dependency installation failed (${code})\n${logs}`));
      });
    });
  }

  private runtimeEnvironment(port: number): NodeJS.ProcessEnv {
    const keep = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME'];
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', PORT: String(port) };
    for (const key of keep) if (process.env[key]) env[key] = process.env[key];
    return env;
  }

  private captureLogs(websiteId: string, runtime: RunningBackend): void {
    const append = (data: Buffer) => (runtime.logs = (runtime.logs + data.toString()).slice(-60_000));
    runtime.child.stdout.on('data', append);
    runtime.child.stderr.on('data', append);
    runtime.child.once('exit', () => {
      const current = this.running.get(websiteId);
      if (current?.child === runtime.child) {
        this.running.delete(websiteId);
        void this.markRuntimeStopped(websiteId, runtime);
      }
    });
  }

  private async stopIdleRuntimes(): Promise<void> {
    const now = Date.now();
    for (const [websiteId, runtime] of this.running.entries()) {
      if (now - runtime.lastRequestAt < this.idleTimeoutMs) continue;
      this.terminate(runtime.child);
      this.running.delete(websiteId);
      await this.markRuntimeStopped(websiteId, runtime);
    }
  }

  private async markRuntimeStopped(websiteId: string, runtime: RunningBackend): Promise<void> {
    if (!ObjectId.isValid(websiteId)) return;
    const website = await this.websites.findOne({ where: { _id: new ObjectId(websiteId) } as any });
    if (!website) return;
    website.backendStatus = 'stopped';
    website.backendProcessId = undefined;
    website.backendPort = undefined;
    website.backendLogs = runtime.logs.slice(-60_000);
    await this.websites.save(website);
  }

  private async waitForHealth(port: number, child: ChildProcessWithoutNullStreams): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Generated backend exited before becoming healthy (${child.exitCode})`);
      try {
        const response = await axios.get(`http://127.0.0.1:${port}/api/health`, { timeout: 500 });
        if (response.status === 200) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error('Generated backend did not become healthy');
  }

  private terminate(child: ChildProcessWithoutNullStreams): void {
    if (!child.killed) child.kill('SIGTERM');
  }
}
