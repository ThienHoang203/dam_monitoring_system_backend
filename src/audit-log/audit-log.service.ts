import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemLog } from './entities/system-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(SystemLog)
    private readonly logRepo: Repository<SystemLog>,
  ) {}

  async logAction(data: {
    action: string;
    category: 'AUTH' | 'DAM' | 'STATION' | 'THRESHOLD';
    description: string;
    username?: string;
    userRole?: string;
    ipAddress?: string;
    metadata?: any;
  }): Promise<SystemLog> {
    try {
      const entry = this.logRepo.create({
        action: data.action,
        category: data.category,
        description: data.description,
        username: data.username || 'System',
        userRole: data.userRole || 'SYSTEM',
        ipAddress: data.ipAddress || undefined,
        metadata: data.metadata || null,
      });
      return await this.logRepo.save(entry);
    } catch (err: any) {
      console.error('[AuditLogService] Error saving log:', err.message);
      return null as any;
    }
  }

  async findAll(category?: string, limit = 100): Promise<SystemLog[]> {
    const qb = this.logRepo.createQueryBuilder('log').orderBy('log.timestamp', 'DESC').take(limit);

    if (category && category !== 'ALL') {
      qb.andWhere('log.category = :category', { category });
    }

    return qb.getMany();
  }
}
