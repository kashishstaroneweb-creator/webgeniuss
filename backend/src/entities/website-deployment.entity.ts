import { Entity, ObjectIdColumn, Column, CreateDateColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('website_deployments')
export class WebsiteDeployment {
  @ObjectIdColumn() id: ObjectId;
  @Column() websiteId: string;
  @Column() userId: string;
  @Column() projectName: string;
  @Column() status: string;
  @Column({ nullable: true }) providerId?: string;
  @Column({ nullable: true }) url?: string;
  @Column({ nullable: true }) message?: string;
  @Column({ nullable: true }) teamId?: string;
  @CreateDateColumn() createdAt: Date;
}
