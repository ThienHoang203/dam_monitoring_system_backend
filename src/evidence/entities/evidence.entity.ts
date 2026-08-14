import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('evidences')
export class Evidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  eventId?: string | null;

  @Column({ type: 'varchar', length: 64 })
  gatewayId: string;

  @Column({ type: 'text' })
  imageUrl: string;

  @Column({ type: 'float', nullable: true })
  confidence: number | null;

  @Column({ type: 'float', nullable: true })
  crackSize: number | null;

  @Column({ type: 'timestamptz' })
  capturedAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
