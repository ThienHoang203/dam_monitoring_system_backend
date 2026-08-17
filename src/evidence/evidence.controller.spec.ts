import { BadRequestException } from '@nestjs/common';
import { EvidenceController } from './evidence.controller';
import { makeAlarmEvent } from '../../test/helpers/factories';
import { createConfigService } from '../../test/helpers/exec-context';

/**
 * Endpoint nhận ảnh từ Jetson TX2 ngoài hiện trường. Là @Public (chỉ chắn bằng
 * GatewayApiKeyGuard) nên phần kiểm tra đầu vào ở đây là lớp phòng thủ chính.
 */
describe('EvidenceController', () => {
  let evidenceService: any;
  let sensorGateway: any;
  let controller: EvidenceController;

  const file = (over: Partial<{ originalname: string; mimetype: string; buffer: Buffer }> = {}) => ({
    originalname: 'crack.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.alloc(1024),
    ...over,
  });

  beforeEach(() => {
    evidenceService = {
      uploadEvidence: jest.fn().mockResolvedValue({ evidence: { id: 'e1' }, updatedAlarm: null }),
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
    };
    sensorGateway = { broadcastAlarm: jest.fn() };
    controller = new EvidenceController(
      evidenceService,
      sensorGateway,
      createConfigService({ MINIO_BUCKET: 'dam-images' }),
    );
  });

  describe('kiểm tra đầu vào khi tải ảnh', () => {
    it('thiếu file → BadRequest', async () => {
      await expect(controller.upload(undefined as any, 'GTW-ST01-TX2A')).rejects.toThrow(
        'Thiếu file ảnh evidence.',
      );
    });

    it('file vượt 10MB → BadRequest', async () => {
      const tooBig = file({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });

      await expect(controller.upload(tooBig, 'GTW-ST01-TX2A')).rejects.toThrow(
        'Dung lượng file tải lên vượt quá giới hạn 10MB.',
      );
      expect(evidenceService.uploadEvidence).not.toHaveBeenCalled();
    });

    it('đúng 10MB vẫn được chấp nhận (biên)', async () => {
      const exact = file({ buffer: Buffer.alloc(10 * 1024 * 1024) });
      await expect(controller.upload(exact, 'GTW-ST01-TX2A')).resolves.toBeDefined();
    });

    it.each(['application/pdf', 'text/plain', 'application/octet-stream'])(
      'định dạng "%s" bị từ chối',
      async (mimetype) => {
        await expect(controller.upload(file({ mimetype }), 'GTW-ST01-TX2A')).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it.each(['image/jpeg', 'image/png', 'image/webp'])('định dạng "%s" được chấp nhận', async (mimetype) => {
      await expect(controller.upload(file({ mimetype }), 'GTW-ST01-TX2A')).resolves.toBeDefined();
    });

    // ⚠️ LỖ HỔNG: điều kiện là `file.mimetype && !startsWith('image/')` nên khi
    // client không gửi Content-Type, file đi lọt qua kiểm tra định dạng hoàn toàn.
    it('LỖ HỔNG: thiếu mimetype thì bỏ qua kiểm tra định dạng', async () => {
      await expect(
        controller.upload(file({ mimetype: undefined }), 'GTW-ST01-TX2A'),
      ).resolves.toBeDefined();
    });

    it('thiếu gateway_id → BadRequest', async () => {
      await expect(controller.upload(file(), '')).rejects.toThrow('Thiếu gateway_id.');
    });
  });

  describe('chuyển tiếp tham số', () => {
    it('chuỗi số được quy đổi sang kiểu số', async () => {
      await controller.upload(
        file(),
        'GTW-ST01-TX2A',
        'EVT-1',
        'NOD-GW01-ESP01',
        '0.93',
        '15.5',
        '22.7',
        '2026-01-01T00:00:00.000Z',
      );

      expect(evidenceService.uploadEvidence).toHaveBeenCalledWith(
        expect.any(Object),
        'GTW-ST01-TX2A',
        0.93,
        '2026-01-01T00:00:00.000Z',
        'EVT-1',
        'NOD-GW01-ESP01',
        15.5,
        22.7,
      );
    });

    it('thiếu độ tin cậy → mặc định 0', async () => {
      await controller.upload(file(), 'GTW-ST01-TX2A');
      expect(evidenceService.uploadEvidence.mock.calls[0][2]).toBe(0);
    });

    it('thiếu dấu thời gian → dùng thời điểm hiện tại', async () => {
      await controller.upload(file(), 'GTW-ST01-TX2A');
      expect(evidenceService.uploadEvidence.mock.calls[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('phát sóng cảnh báo sau khi ghép ảnh', () => {
    it('ghép được vào cảnh báo → phát sóng với URL đã đổi sang proxy', async () => {
      evidenceService.uploadEvidence.mockResolvedValue({
        evidence: { id: 'e1' },
        updatedAlarm: makeAlarmEvent({
          imageUrl: 'http://minio:9000/dam-images/evidence/a.jpg',
        }),
      });

      await controller.upload(file(), 'GTW-ST01-TX2A');

      expect(sensorGateway.broadcastAlarm).toHaveBeenCalledWith(
        expect.objectContaining({ imageUrl: '/sensor/images/evidence/a.jpg' }),
      );
    });

    it('không ghép được cảnh báo nào → không phát sóng', async () => {
      await controller.upload(file(), 'GTW-ST01-TX2A');
      expect(sensorGateway.broadcastAlarm).not.toHaveBeenCalled();
    });
  });

  // ⚠️ LỖ HỔNG: hai endpoint đọc chỉ có @Roles('ADMIN','OPERATOR'), không kiểm
  // assignedDamId — OPERATOR xem được ảnh bằng chứng của mọi đập.
  describe('thiếu phân quyền theo đập ở endpoint đọc', () => {
    it('LỖ HỔNG: danh sách bằng chứng không lọc theo đập', async () => {
      await controller.findAll('GTW-ST99-TX2A');
      expect(evidenceService.findAll).toHaveBeenCalledWith('GTW-ST99-TX2A', 50);
    });

    it('LỖ HỔNG: đọc được bằng chứng bất kỳ theo id', async () => {
      await expect(controller.findById('evidence-uuid-cua-dap-khac')).resolves.toBeDefined();
    });
  });
});
