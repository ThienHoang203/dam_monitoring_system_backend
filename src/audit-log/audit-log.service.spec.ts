import { AuditLogService } from './audit-log.service';
import { createMockRepo, createMockQueryBuilder, MockRepo } from '../../test/helpers/mock-repo';

describe('AuditLogService', () => {
  let logRepo: MockRepo;
  let service: AuditLogService;

  beforeEach(() => {
    logRepo = createMockRepo();
    service = new AuditLogService(logRepo as any);
  });

  describe('logAction', () => {
    it('điền giá trị mặc định cho các trường không khai', async () => {
      await service.logAction({ action: 'LOGIN', category: 'AUTH', description: 'x' });

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'System', userRole: 'SYSTEM', metadata: null }),
      );
    });

    // Ghi nhật ký là phụ trợ: DB log hỏng KHÔNG được phép làm hỏng đăng nhập
    // hay thao tác CRUD đang gọi nó. Hàm nuốt mọi lỗi và trả null.
    it('lỗi ghi DB bị nuốt, trả null thay vì ném ra ngoài', async () => {
      logRepo.save.mockRejectedValue(new Error('DB down'));

      await expect(
        service.logAction({ action: 'LOGIN', category: 'AUTH', description: 'x' }),
      ).resolves.toBeNull();
    });
  });

  describe('findAll — phân trang', () => {
    let qb: any;

    beforeEach(() => {
      qb = createMockQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      logRepo.createQueryBuilder.mockReturnValue(qb);
    });

    it.each([
      [0, 1, 'dưới ngưỡng tối thiểu'],
      [9999, 200, 'vượt trần'],
      [50, 50, 'trong khoảng hợp lệ'],
    ])('pageSize %p được kẹp về %p (%s)', async (input, expected) => {
      await service.findAll(undefined, input as number, 1);
      expect(qb.take).toHaveBeenCalledWith(expected);
    });

    it('số trang nhỏ hơn 1 được kẹp về trang đầu', async () => {
      await service.findAll(undefined, 20, -5);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('tính đúng offset của trang thứ 3', async () => {
      await service.findAll(undefined, 20, 3);
      expect(qb.skip).toHaveBeenCalledWith(40);
    });

    it('category "ALL" không thêm điều kiện lọc', async () => {
      await service.findAll('ALL');
      const conditions = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(conditions.some((c: string) => c.includes('log.category'))).toBe(false);
    });

    it('category cụ thể được đưa vào điều kiện lọc', async () => {
      await service.findAll('AUTH');
      expect(qb.andWhere).toHaveBeenCalledWith('log.category = :category', { category: 'AUTH' });
    });

    it('từ khoá tìm kiếm được trim và tra trên 3 cột', async () => {
      await service.findAll(undefined, 20, 1, '  admin  ');

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        { q: '%admin%' },
      );
    });

    it('quy đổi số đếm theo category từ chuỗi sang số', async () => {
      qb.getRawMany.mockResolvedValue([
        { category: 'AUTH', count: '12' },
        { category: 'DAM', count: '3' },
      ]);

      const { categoryCounts } = await service.findAll();

      expect(categoryCounts).toEqual({ AUTH: 12, DAM: 3 });
    });
  });
});
