import { Column, CreateDateColumn, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

export type CreditLedgerType =
  | 'purchase'
  | 'generation'
  | 'refund'
  | 'admin_adjustment'
  | 'subscription_grant';

@Entity('credit_ledger')
export class CreditLedger {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  userId: string;

  @Column()
  type: CreditLedgerType;

  @Column()
  amount: number;

  @Column()
  balanceBefore: number;

  @Column()
  balanceAfter: number;

  @Column({ nullable: true })
  reason?: string;

  @Column({ nullable: true })
  referenceId?: string;

  @Column({ nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt: Date;
}
