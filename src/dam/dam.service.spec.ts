import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DamService } from './dam.service';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';
import { priv } from '../../test/helpers/build-sensor-service';
import { makeDam, makeStation } from '../../test/helpers/factories';

/**
 * Danh mục thiết bị gốc: Đập → Trạm quan trắc.
 * Mã sinh ra ở đây được nhúng vào mã gateway/node/camera nên phải tuyệt đối đúng chuẩn A.3.2.
 */
describe('DamService', () => {
  let damRepo: MockRepo;
  let stationRepo: MockRepo;
  let sensorService: any;
  let auditLogService: { logAction: jest.Mock };
  let service: DamService;

  beforeEach(() => {
    damRepo = createMockRepo();
    stationRepo = createMockRepo();
    sensorService = {
      registerStationDam: jest.fn(),
      ensureThresholdConfigs: jest.fn().mockResolvedValue(undefined),
      recomputeStationStatus: jest.fn().mockResolvedValue(undefined),
      recomputeDamStatus: jest.fn().mockResolvedValue(undefined),
      deleteThresholdConfigsByStation: jest.fn().mockResolvedValue(undefined),
      deleteThresholdConfigsByDam: jest.fn().mockResolvedValue(undefined),
    };
    auditLogService = { logAction: jest.fn().mockResolvedValue(null) };

    service = new DamService(
      damRepo as any,
      stationRepo as any,
      createMockRepo() as any, // gateway
      createMockRepo() as any, // camera
      createMockRepo() as any, // node
      createMockRepo() as any, // sensor
      auditLogService as any,
      sensorService,
    );
  });

  describe('sinh mã đập', () => {
    const nextSeq = () => priv(service).nextDamSequence();

    it('chưa có đập nào → số thứ tự 1', async () => {
      damRepo.find.mockResolvedValue([]);
      await expect(nextSeq()).resolves.toBe(1);
    });

    it('lấy số lớn nhất rồi cộng 1', async () => {
      damRepo.find.mockResolvedValue([{ damId: 'DAM-001' }, { damId: 'DAM-003' }]);
      await expect(nextSeq()).resolves.toBe(4);
    });

    // Cố ý KHÔNG lấp chỗ trống: mã đập đã dùng rồi bị xoá vẫn không được tái sử dụng,
    // tránh nhầm lẫn với dữ liệu lịch sử vẫn còn tham chiếu mã cũ.
    it('không lấp lỗ trống trong dãy số', async () => {
      damRepo.find.mockResolvedValue([{ damId: 'DAM-001' }, { damId: 'DAM-005' }]);
      await expect(nextSeq()).resolves.toBe(6);
    });

    it('bỏ qua mã không đúng định dạng', async () => {
      damRepo.find.mockResolvedValue([{ damId: 'DAM-XYZ' }, { damId: null }]);
      await expect(nextSeq()).resolves.toBe(1);
    });

    it('damCodeOf tách phần số từ mã đập', () => {
      expect(priv(service).damCodeOf('DAM-007')).toBe('007');
    });

    it('damCodeOf trả 000 khi mã sai định dạng', () => {
      expect(priv(service).damCodeOf('KHONG-HOP-LE')).toBe('000');
    });
  });

  describe('sinh mã trạm', () => {
    it('trạm đầu tiên của đập → STA-001-01', async () => {
      stationRepo.find.mockResolvedValue([]);
      await expect(priv(service).nextStationId(makeDam({ damId: 'DAM-001' }))).resolves.toBe(
        'STA-001-01',
      );
    });

    it('đánh số tiếp theo trạm lớn nhất trong cùng đập', async () => {
      stationRepo.find.mockResolvedValue([
        { stationId: 'STA-001-01' },
        { stationId: 'STA-001-02' },
      ]);
      await expect(priv(service).nextStationId(makeDam({ damId: 'DAM-001' }))).resolves.toBe(
        'STA-001-03',
      );
    });

    it('mỗi đập có dãy số trạm độc lập', async () => {
      stationRepo.find.mockResolvedValue([{ stationId: 'STA-001-05' }]);
      await expect(
        priv(service).nextStationId(makeDam({ id: 2, damId: 'DAM-002' })),
      ).resolves.toBe('STA-002-01');
    });

    // stationCode được nhúng vào mã gateway (GTW-ST01-TX2A) nên phải duy nhất
    // trên TOÀN hệ thống, không chỉ trong phạm vi một đập.
    it('stationCode duy nhất toàn hệ thống, không theo từng đập', async () => {
      stationRepo.find.mockResolvedValue([{ stationCode: 'ST01' }, { stationCode: 'ST09' }]);
      await expect(priv(service).nextStationCode()).resolves.toBe('ST10');
    });

    it('stationCode vượt 2 chữ số vẫn tăng đúng', async () => {
      stationRepo.find.mockResolvedValue([{ stationCode: 'ST100' }]);
      await expect(priv(service).nextStationCode()).resolves.toBe('ST101');
    });
  });

  describe('createDam', () => {
    beforeEach(() => {
      damRepo.find.mockResolvedValue([]);
      // findOne phục vụ hai vai trò: kiểm tra trùng mã (chỉ chạy khi client tự khai
      // damId) và findDamById ở cuối để trả về bản ghi vừa tạo.
      damRepo.findOne.mockResolvedValue(makeDam());
      damRepo.save.mockImplementation((d: any) => Promise.resolve({ id: 1, ...d }));
    });

    it('không khai mã thì tự sinh theo chuẩn', async () => {
      await service.createDam({ name: 'Đập mới' } as any);
      expect(damRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ damId: 'DAM-001' }),
      );
    });

    it('mã tự truyền sai chuẩn → BadRequest', async () => {
      await expect(
        service.createDam({ damId: 'DAM-1', name: 'Đập' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('mã đã tồn tại → Conflict, không ghi đè', async () => {
      await expect(
        service.createDam({ damId: 'DAM-001', name: 'Đập' } as any),
      ).rejects.toThrow(ConflictException);
    });

    // Trạng thái an toàn chỉ được tính từ dữ liệu quan trắc thật, client không
    // được phép khai báo đập của mình đang "an toàn".
    it('luôn khởi tạo trạng thái "unknown", bỏ qua giá trị client gửi', async () => {
      await service.createDam({ name: 'Đập', status: 'safe' } as any);
      expect(damRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unknown' }),
      );
    });

    it('ghi nhật ký hệ thống', async () => {
      await service.createDam({ name: 'Đập mới' } as any);
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'DAM' }),
      );
    });
  });

  describe('resolveDamRef / resolveStationRef', () => {
    it('đập không tồn tại → NotFound kèm mã', async () => {
      damRepo.findOne.mockResolvedValue(null);
      await expect(service.resolveDamRef('DAM-999')).rejects.toThrow(
        'Đập "DAM-999" không tồn tại.',
      );
    });

    it('trạm không tồn tại → NotFound', async () => {
      stationRepo.findOne.mockResolvedValue(null);
      await expect(service.resolveStationRef('STA-999-99')).rejects.toThrow(NotFoundException);
    });
  });

  describe('dọn dẹp khi xoá thiết bị', () => {
    // ThresholdConfig không có khoá ngoại tới Station/Dam (cố ý, để dữ liệu ngưỡng
    // không bị cascade mất) nên phải dọn tay, nếu không sẽ thành bản ghi mồ côi.
    it('xoá trạm → dọn cấu hình ngưỡng của trạm đó', async () => {
      stationRepo.findOne.mockResolvedValue(makeStation());

      await service.deleteStation('STA-001-01');

      expect(sensorService.deleteThresholdConfigsByStation).toHaveBeenCalledWith('STA-001-01');
    });

    it('xoá đập → dọn cấu hình ngưỡng của cả đập', async () => {
      damRepo.findOne.mockResolvedValue(makeDam());

      await service.deleteDam('DAM-001');

      expect(sensorService.deleteThresholdConfigsByDam).toHaveBeenCalledWith('DAM-001');
    });

    it('xoá đập không tồn tại → NotFound', async () => {
      damRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteDam('DAM-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createStation', () => {
    beforeEach(() => {
      damRepo.findOne.mockResolvedValue(makeDam({ id: 1, damId: 'DAM-001' }));
      stationRepo.find.mockResolvedValue([]);
      // Lời gọi đầu là kiểm tra trùng tên trạm (phải null); lời gọi cuối là
      // findStationById trả bản ghi vừa tạo.
      stationRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeStation());
      stationRepo.save.mockImplementation((s: any) => Promise.resolve({ id: 1, ...s }));
    });

    it('đập không tồn tại → NotFound', async () => {
      damRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createStation({ damId: 'DAM-999', name: 'Trạm' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('đăng ký trạm vào bản đồ topology trong bộ nhớ', async () => {
      await service.createStation({ damId: 'DAM-001', name: 'Trạm 1' } as any);
      expect(sensorService.registerStationDam).toHaveBeenCalled();
    });

    it('tạo sẵn bộ cấu hình ngưỡng mặc định cho trạm mới', async () => {
      await service.createStation({ damId: 'DAM-001', name: 'Trạm 1' } as any);
      expect(sensorService.ensureThresholdConfigs).toHaveBeenCalled();
    });
  });
});
