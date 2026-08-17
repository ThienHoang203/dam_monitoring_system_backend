import { ForbiddenException } from '@nestjs/common';
import { DamController } from './dam.controller';
import { makeAdmin, makeDam, makeOperator, makeStation, makeViewer } from '../../test/helpers/factories';

/**
 * Phân quyền theo đập (dam-scoping) được cài ĐẶT TAY ở từng method controller,
 * không tập trung một chỗ. Mỗi method vì thế là một cơ hội rò rỉ dữ liệu chéo đập
 * độc lập và cần test riêng.
 *
 * Quy ước: OPERATOR chỉ được thấy đập ghi ở `assignedDamId`.
 */
describe('DamController — phân quyền theo đập', () => {
  let damService: any;
  let controller: DamController;

  const damA = makeDam({ id: 1, damId: 'DAM-001' });
  const damB = makeDam({ id: 2, damId: 'DAM-002' });

  beforeEach(() => {
    damService = {
      findAllDams: jest.fn().mockResolvedValue([damA, damB]),
      findDamById: jest.fn().mockResolvedValue(damA),
      findAllStations: jest.fn().mockResolvedValue([]),
      findStationById: jest.fn(),
      createDam: jest.fn().mockResolvedValue(damA),
      updateDam: jest.fn().mockResolvedValue(damA),
      deleteDam: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new DamController(damService);
  });

  describe('GET /dams', () => {
    it('khách vãng lai thấy toàn bộ đập', async () => {
      const { dams } = await controller.findAllDams(undefined);
      expect(dams).toHaveLength(2);
    });

    it('ADMIN thấy toàn bộ đập', async () => {
      const { dams } = await controller.findAllDams(makeAdmin());
      expect(dams).toHaveLength(2);
    });

    it('OPERATOR chỉ thấy đập được phân công', async () => {
      const { dams } = await controller.findAllDams(makeOperator('DAM-002'));
      expect(dams).toEqual([damB]);
    });

    it('VIEWER thấy toàn bộ đập (không bị thu hẹp)', async () => {
      const { dams } = await controller.findAllDams(makeViewer());
      expect(dams).toHaveLength(2);
    });

    // ⚠️ OPERATOR chưa được gán đập thì KHÔNG bị lọc — nhìn thấy mọi đập.
    // Khoá hành vi hiện tại; đây là điểm nên siết lại (từ chối thay vì mở).
    it('OPERATOR chưa gán đập thấy toàn bộ (chưa được siết)', async () => {
      const { dams } = await controller.findAllDams(makeOperator(null as any));
      expect(dams).toHaveLength(2);
    });
  });

  describe('GET /dams/:id', () => {
    it('OPERATOR truy cập đúng đập của mình → cho phép', async () => {
      await expect(
        controller.findDamById('DAM-001', makeOperator('DAM-001')),
      ).resolves.toBeDefined();
    });

    it('OPERATOR truy cập đập khác → Forbidden', async () => {
      await expect(controller.findDamById('DAM-002', makeOperator('DAM-001'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    // Chặn TRƯỚC khi gọi service: không để lộ thông tin qua thời gian phản hồi
    // và không tiêu tốn truy vấn cho request bị từ chối.
    it('bị chặn thì không truy vấn DB', async () => {
      await expect(
        controller.findDamById('DAM-002', makeOperator('DAM-001')),
      ).rejects.toThrow();
      expect(damService.findDamById).not.toHaveBeenCalled();
    });

    it('ADMIN truy cập được mọi đập', async () => {
      await expect(controller.findDamById('DAM-002', makeAdmin())).resolves.toBeDefined();
    });

    it('khách vãng lai truy cập được (endpoint công khai)', async () => {
      await expect(controller.findDamById('DAM-002', undefined)).resolves.toBeDefined();
    });
  });

  describe('GET /stations', () => {
    it('OPERATOR bị ép về đập của mình DÙ query hỏi đập khác', async () => {
      await controller.findAllStations('DAM-002', makeOperator('DAM-001'));
      expect(damService.findAllStations).toHaveBeenCalledWith('DAM-001');
    });

    it('ADMIN dùng đúng damId trong query', async () => {
      await controller.findAllStations('DAM-002', makeAdmin());
      expect(damService.findAllStations).toHaveBeenCalledWith('DAM-002');
    });

    it('khách vãng lai dùng đúng damId trong query', async () => {
      await controller.findAllStations('DAM-002', undefined);
      expect(damService.findAllStations).toHaveBeenCalledWith('DAM-002');
    });
  });

  describe('GET /stations/:id', () => {
    it('OPERATOR xem trạm thuộc đập khác → Forbidden', async () => {
      damService.findStationById.mockResolvedValue(
        makeStation({ stationId: 'STA-002-01', dam: damB }),
      );

      await expect(
        controller.findStationById('STA-002-01', makeOperator('DAM-001')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('OPERATOR xem trạm thuộc đập mình → cho phép', async () => {
      damService.findStationById.mockResolvedValue(
        makeStation({ stationId: 'STA-001-01', dam: damA }),
      );

      await expect(
        controller.findStationById('STA-001-01', makeOperator('DAM-001')),
      ).resolves.toBeDefined();
    });

    // ⚠️ Khác với findDamById: ở đây service được gọi TRƯỚC rồi mới kiểm quyền.
    // Dữ liệu đã được đọc khỏi DB trước khi request bị từ chối.
    it('kiểm quyền diễn ra SAU khi đã truy vấn trạm', async () => {
      damService.findStationById.mockResolvedValue(
        makeStation({ stationId: 'STA-002-01', dam: damB }),
      );

      await expect(
        controller.findStationById('STA-002-01', makeOperator('DAM-001')),
      ).rejects.toThrow();
      expect(damService.findStationById).toHaveBeenCalled();
    });

    // station.damId là trường ảo do @AfterLoad điền, chỉ có giá trị khi quan hệ dam
    // đã được load. Không load quan hệ → damId undefined → so sánh luôn khác →
    // OPERATOR bị chặn khỏi chính trạm của mình.
    it('quan hệ dam chưa load → damId undefined → OPERATOR bị chặn nhầm', async () => {
      damService.findStationById.mockResolvedValue(
        makeStation({ stationId: 'STA-001-01', dam: undefined }),
      );

      await expect(
        controller.findStationById('STA-001-01', makeOperator('DAM-001')),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
