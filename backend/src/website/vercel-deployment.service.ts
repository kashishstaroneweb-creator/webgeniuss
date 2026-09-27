import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { Website } from '../entities/website.entity';
import { User } from '../entities/user.entity';
import { WebsiteDeployment } from '../entities/website-deployment.entity';
import { ReactPreviewBuildService } from './react-preview-build.service';
import { DeployWebsiteDto } from './dto/deploy-website.dto';
import { DeploymentFile, publicBackendUrl, vercelBundle } from './vercel-bundle';

const ACTIVE = ['SUBMITTING', 'QUEUED', 'INITIALIZING', 'BUILDING'];

@Injectable()
export class VercelDeploymentService {
  private readonly submitting = new Set<string>();
  constructor(
    @InjectRepository(Website) private readonly websites: Repository<Website>,
    @InjectRepository(WebsiteDeployment) private readonly deployments: Repository<WebsiteDeployment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly previews: ReactPreviewBuildService,
  ) {}

  private async owned(id: string, userId: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException('Project not found');
    const site = await this.websites.findOne({ where: { _id: new ObjectId(id), userId } as any });
    if (!site || site.userId !== userId) throw new NotFoundException('Project not found');
    return site;
  }

  private latest(websiteId: string, userId: string) {
    return this.deployments.findOne({ where: { websiteId, userId }, order: { createdAt: 'DESC' } });
  }

  private requestOptions(teamId?: string) {
    const token = process.env.VERCEL_TOKEN?.trim();
    if (!token) throw new ServiceUnavailableException('Vercel deployment is not configured. Ask your administrator to set VERCEL_TOKEN on the backend.');
    return { headers: { Authorization: `Bearer ${token}` }, params: teamId ? { teamId } : {}, timeout: 45_000 };
  }

  private view(record: WebsiteDeployment | null) {
    if (!record) return null;
    return { id: record.id.toString(), status: record.status, url: record.url, message: record.message,
      projectName: record.projectName, createdAt: record.createdAt };
  }

  private applyResponse(record: WebsiteDeployment, data: any) {
    const state = data.readyState || data.status;
    record.status = ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED'].includes(state) ? state : 'QUEUED';
    if (typeof data.url === 'string' && /^[a-z0-9.-]+\.vercel\.app$/i.test(data.url)) record.url = `https://${data.url}`;
    record.message = record.status === 'ERROR' ? 'Vercel could not build this project. Check its build logs in your Vercel dashboard, fix the generated code, then redeploy.'
      : record.status === 'CANCELED' ? 'This deployment was canceled in Vercel.' : undefined;
  }

  async status(id: string, userId: string) {
    const site = await this.owned(id, userId);
    const record = await this.latest(id, userId);
    const configured = !!process.env.VERCEL_TOKEN?.trim();
    if (record?.providerId && (ACTIVE.includes(record.status) || record.status === 'UNKNOWN') && configured) {
      try {
        const { data } = await axios.get(`https://api.vercel.com/v13/deployments/${encodeURIComponent(record.providerId)}`, this.requestOptions(record.teamId));
        this.applyResponse(record, data);
        await this.deployments.save(record);
      } catch {
        throw new BadGatewayException('Could not refresh the Vercel deployment. Try refreshing its status again.');
      }
    } else if (record?.status === 'SUBMITTING' && Date.now() - new Date(record.createdAt).getTime() > 120_000) {
      record.status = 'UNKNOWN';
      record.message = 'Submission was interrupted. Check the Vercel dashboard before deploying again.';
      await this.deployments.save(record);
    }
    return { configured, requiresBackendUrl: !!site.backendFiles?.length, deployment: this.view(record) };
  }

  async deploy(id: string, userId: string, dto: DeployWebsiteDto) {
    const site = await this.owned(id, userId);
    if (!ObjectId.isValid(userId)) throw new ForbiddenException('Account not found');
    const user = await this.users.findOne({ where: { _id: new ObjectId(userId) } as any });
    if (!user || user.accountStatus === 'suspended') throw new ForbiddenException('Your account cannot deploy projects.');
    const teamId = process.env.VERCEL_TEAM_ID?.trim() || undefined;
    const options = this.requestOptions(teamId);
    const backendUrl = publicBackendUrl(dto.backendUrl);
    if (site.backendFiles?.length && !backendUrl) throw new BadRequestException('Enter the hosted backend base URL before deploying this full-stack frontend.');
    if (this.submitting.has(id)) throw new ConflictException('A deployment is already being submitted.');
    this.submitting.add(id);
    let record: WebsiteDeployment | undefined;
    let submitted = false;
    try {
      const current = await this.latest(id, userId);
      if (current && ACTIVE.includes(current.status)) throw new ConflictException('This project already has a deployment in progress. Refresh its status first.');
      const framework = site.framework === 'html' ? null : site.framework === 'next' ? 'nextjs' : 'vite';
      let source: DeploymentFile[];
      if (framework === 'nextjs') {
        if (!site.v0ChatId || !process.env.V0_API_KEY?.trim()) throw new BadRequestException('This Next.js project needs its original v0 chat and a configured V0_API_KEY to retrieve complete source files.');
        try {
          const { data } = await axios.get(`${(process.env.V0_API_URL || 'https://api.v0.dev/v1').replace(/\/+$/, '')}/chats/${encodeURIComponent(site.v0ChatId)}`, {
            headers: { Authorization: `Bearer ${process.env.V0_API_KEY.trim()}` }, timeout: 45_000, maxContentLength: 8 * 1024 * 1024,
          });
          if (data.latestVersion?.status !== 'completed' || !Array.isArray(data.latestVersion.files)) throw new Error('Incomplete source');
          source = data.latestVersion.files.map((file: any) => ({ file: file.name, data: file.content }));
        } catch { throw new BadGatewayException('Could not retrieve completed Next.js source from v0. Finish generation and try again.'); }
      } else {
        try { source = this.previews.deploymentFiles(site); }
        catch { throw new BadRequestException('This project does not contain valid saved frontend code for deployment.'); }
      }
      const files = vercelBundle(source, framework, backendUrl);
      const projectName = `webgenius-${id}`;
      record = await this.deployments.save(this.deployments.create({ websiteId: id, userId, projectName, status: 'SUBMITTING', teamId }));
      submitted = true;
      const { data } = await axios.post('https://api.vercel.com/v13/deployments', {
        name: projectName, target: 'production', files,
        projectSettings: { framework, ...(framework === 'vite' ? { outputDirectory: 'dist' } : {}),
          buildCommand: framework ? 'npm run build' : '', installCommand: framework ? 'npm install --ignore-scripts --no-audit --no-fund' : '',
        },
      }, options);
      if (typeof data.id !== 'string' || !data.id.startsWith('dpl_')) throw new Error('Invalid Vercel response');
      record.providerId = data.id;
      this.applyResponse(record, data);
      await this.deployments.save(record);
      return this.view(record);
    } catch (error: any) {
      if (!submitted) throw error;
      if (record) {
        record.status = !error.response || error.response.status >= 500 ? 'UNKNOWN' : 'ERROR';
        record.message = record.status === 'UNKNOWN'
          ? 'Vercel may have received this deployment. Check your Vercel dashboard before retrying.'
          : error.response.status === 401 || error.response.status === 403
            ? 'Vercel access was denied. Ask your administrator to check the token and team settings.'
            : error.response.status === 429 ? 'Vercel deployment limits were reached. Try again later.'
              : 'Vercel rejected the deployment. Check the project source and your Vercel account settings.';
        await this.deployments.save(record);
      }
      throw new BadGatewayException(record?.message || 'Could not submit deployment to Vercel.');
    } finally { this.submitting.delete(id); }
  }
}
