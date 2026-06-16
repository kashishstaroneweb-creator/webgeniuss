import { Column, CreateDateColumn, Entity, ObjectIdColumn, UpdateDateColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

export type GenerationUsageStatus = 'started' | 'success' | 'failed';
export type GenerationUsageKind = 'generate' | 'edit';

@Entity('generation_usage')
export class GenerationUsage {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  userId: string;

  @Column({ nullable: true })
  websiteId?: string;

  @Column()
  kind: GenerationUsageKind;

  @Column({ nullable: true })
  promptPreview?: string;

  @Column({ nullable: true })
  framework?: 'next' | 'react' | 'html';

  @Column({ default: false })
  imageAttached: boolean;

  @Column()
  status: GenerationUsageStatus;

  @Column()
  estimatedCostCredits: number;

  @Column({ nullable: true })
  actualCostCredits?: number;

  @Column({ nullable: true })
  v0ChatId?: string;

  @Column({ nullable: true })
  v0DemoUrl?: string;

  @Column({ nullable: true })
  durationMs?: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  startedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  finishedAt?: Date;
}
