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
    category: 'AUTH' | 'DAM' | 'STATION' | 'GATEWAY' | 'THRESHOLD';
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

  async findAll(
    category?: string,
    pageSize = 20,
    page = 1,
    search?: string,
  ): Promise<{
    logs: SystemLog[];
    total: number;
    categoryCounts: Record<string, number>;
  }> {
    const safePageSize = Math.max(1, Math.min(pageSize, 200));
    const safePage = Math.max(1, page);
    const trimmedSearch = search?.trim();

    const applySearch = (qb: ReturnType<Repository<SystemLog>['createQueryBuilder']>) => {
      if (trimmedSearch) {
        qb.andWhere(
          '(log.description ILIKE :q OR log.username ILIKE :q OR log.action ILIKE :q)',
          { q: `%${trimmedSearch}%` },
        );
      }
      return qb;
    };

    const qb = this.logRepo
      .createQueryBuilder('log')
      .orderBy('log.timestamp', 'DESC')
      .skip((safePage - 1) * safePageSize)
      .take(safePageSize);
    if (category && category !== 'ALL') {
      qb.andWhere('log.category = :category', { category });
    }
    applySearch(qb);

    // Phân bổ số lượng theo category — luôn tính trên toàn bộ dữ liệu khớp tìm kiếm,
    // không phụ thuộc tab category đang chọn, để các thẻ thống kê luôn chính xác.
    const countQb = this.logRepo
      .createQueryBuilder('log')
      .select('log.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.category');
    applySearch(countQb);

    const [[logs, total], countRows] = await Promise.all([
      qb.getManyAndCount(),
      countQb.getRawMany<{ category: string; count: string }>(),
    ]);

    const categoryCounts = countRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.category] = parseInt(row.count, 10);
      return acc;
    }, {});

    return { logs, total, categoryCounts };
  }
}
