import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Dam } from './dam.entity';

@Entity('stations')
export class Station {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  river: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  km: string;

  @Column({ type: 'varchar', length: 16, default: 'safe' })
  status: string;

  @Column({ type: 'float', default: 0 })
  waterLevel: number;

  @Column({ type: 'float', default: 0 })
  change: number;

  @Column({ type: 'float', default: 0 })
  pressure: number;

  @Column({ type: 'float', default: 0 })
  flow: number;

  @Column({ type: 'float', default: 0 })
  humidity: number;

  @Column({ type: 'float', default: 0 })
  bd1: number;

  @Column({ type: 'float', default: 0 })
  bd2: number;

  @Column({ type: 'float', default: 0 })
  bd3: number;

  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @ManyToOne(() => Dam, dam => dam.stations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'damId' })
  dam: Dam;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
