import { Entity, Column, ObjectIdColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ObjectId } from 'mongodb';
import { User } from './user.entity';

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

