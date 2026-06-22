import { Column, CreateDateColumn, Entity, ObjectIdColumn, UpdateDateColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

export type WebsiteTemplateStatus = 'draft' | 'published' | 'archived';
export type WebsiteTemplateFramework = 'next' | 'react' | 'html';

@Entity('website_templates')
export class WebsiteTemplate {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  name: string;

  @Column()
  slug: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ type: 'json', nullable: true })
  tags?: string[];

  @Column({ nullable: true })
  framework?: WebsiteTemplateFramework;

  @Column({ nullable: true })
  thumbnailUrl?: string;

  @Column({ nullable: true })
  sourceWebsiteId?: string;

  @Column({ nullable: true })
  createdByAdminId?: string;

  @Column({ type: 'text', nullable: true })
  prompt?: string;

  @Column({ type: 'text', nullable: true })
  basePrompt?: string;

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
  v0DemoUrl?: string;

  @Column({ nullable: true })
  reactArtifactUrl?: string;

  @Column({ nullable: true })
  reactBuildStatus?: 'queued' | 'building' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  reactBuildLog?: string;

  @Column({ nullable: true })
  status?: WebsiteTemplateStatus;

  @Column({ nullable: true })
  isFeatured?: boolean;

  @Column({ nullable: true })
  isPremium?: boolean;

  @Column({ nullable: true })
  sortOrder?: number;

  @Column({ nullable: true })
  publishedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
