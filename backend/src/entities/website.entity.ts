import { Entity, Column, ObjectIdColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ObjectId } from 'mongodb';
import { User } from './user.entity';

export interface GeneratedProjectFile {
  path: string;
  content: string;
}

export interface FullStackBlueprint {
  projectName: string;
  summary: string;
  features: string[];
  dataModels: Array<{
    name: string;
    fields: Array<{ name: string; type: 'string' | 'number' | 'boolean'; required: boolean }>;
  }>;
  api: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    description: string;
    requestBody: Array<{ name: string; type: string; required: boolean }>;
    responseShape: string;
  }>;
}

@Entity('websites')
export class Website {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  websiteName: string;

  @Column({ nullable: true })
  framework?: 'next' | 'react' | 'html';

  @Column({ type: 'text', nullable: true })
  prompt?: string;

  @Column({ nullable: true })
  templateId?: string;

  @Column({ nullable: true })
  templateName?: string;

  @Column('text')
  htmlCode: string;

  @Column('text')
  cssCode: string;

  @Column('text')
  jsCode: string;

  @Column({ type: 'json', nullable: true })
  components?: Array<{
    name: string;
    type: 'component' | 'page' | 'util';
    path: string;
    code: string;
    language: 'html' | 'css' | 'js' | 'jsx';
  }>;

  @Column({ type: 'json', nullable: true })
  viteConfig?: {
    packageJson: string;
    viteConfig: string;
    indexHtml: string;
    mainJs?: string;
    mainJsx?: string;
    styleCss: string;
  };

  @Column({ nullable: true })
  generatedPath?: string;

  /** Shared contract used by OpenAI for the API and v0 for the UI. */
  @Column({ type: 'json', nullable: true })
  fullStackBlueprint?: FullStackBlueprint;

  /** Plain Node.js/Express files generated separately by OpenAI. */
  @Column({ type: 'json', nullable: true })
  backendFiles?: GeneratedProjectFile[];

  @Column({ nullable: true })
  backendStatus?: 'generated' | 'installing' | 'running' | 'stopped' | 'failed';

  @Column({ type: 'text', nullable: true })
  backendLogs?: string;

  @Column({ nullable: true })
  backendPort?: number;

  @Column({ nullable: true })
  backendProcessId?: number;

  @Column({ nullable: true })
  backendPreviewUrl?: string;

  /** v0 Platform API chat id (source of truth for hosted demo). */
  @Column({ nullable: true })
  v0ChatId?: string;

  /** Hosted preview URL from v0 (`demo` / `latestVersion.demoUrl`), same pattern as v0-clone. */
  @Column({ nullable: true })
  v0DemoUrl?: string;

  /** React-only build pipeline status for artifact previews. */
  @Column({ nullable: true })
  reactBuildStatus?: 'queued' | 'building' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  reactBuildLog?: string;

  @Column({ nullable: true })
  reactBuildId?: string;

  @Column({ nullable: true })
  reactArtifactUrl?: string;

  @Column({ nullable: true })
  reactBuildStartedAt?: Date;

  @Column({ nullable: true })
  reactBuildFinishedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}

