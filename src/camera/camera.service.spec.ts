import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CameraService } from './camera.service';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';
import { makeCamera, makeGateway, makeStation } from '../../test/helpers/factories';

describe('CameraService', () => {
  let cameraRepo: MockRepo;
  let gatewayService: { findById: jest.Mock; publishGatewayConfig: jest.Mock };
  let service: CameraService;

  const gateway = makeGateway({
    id: 1,
    gatewayId: 'GTW-ST01-TX2A',
    station: makeStation({ stationCode: 'ST01' }),
  });

  beforeEach(() => {
    cameraRepo = createMockRepo();
    gatewayService = {
      findById: jest.fn().mockResolvedValue(gateway),
      publishGatewayConfig: jest.fn().mockResolvedValue(undefined),
    };
    service = new CameraService(cameraRepo as any, gatewayService as any);
  });

  describe('ràng buộc loại camera', () => {
    // Camera IP không có RTSP URL thì Jetson TX2 không kết nối được — phải chặn từ đầu.
    it('camera IP thiếu streamUrl → BadRequest', async () => {
      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'IP', name: 'Cam' } as any),
      ).rejects.toThrow('Camera loại IP bắt buộc phải có streamUrl (RTSP URL).');
    });

    it('camera CSI không cần streamUrl', async () => {
      cameraRepo.find.mockResolvedValue([]);
      cameraRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeCamera());

      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'CSI', name: 'Cam' } as any),
      ).resolves.toBeDefined();
    });

    it('loại camera không hợp lệ bị chặn trước cả kiểm tra streamUrl', async () => {
      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'USB', name: 'Cam' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(gatewayService.findById).not.toHaveBeenCalled();
    });
  });

  describe('sinh mã camera theo chuẩn A.3.2', () => {
    const createCsi = async () => {
      cameraRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeCamera());
      await service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'CSI', name: 'Cam' } as any);
      return cameraRepo.create.mock.calls[0][0].cameraId;
    };

    it('camera đầu tiên của trạm → CAM-CSI-ST01-01', async () => {
      cameraRepo.find.mockResolvedValue([]);
      expect(await createCsi()).toBe('CAM-CSI-ST01-01');
    });

    it('đánh số tiếp theo mã lớn nhất hiện có', async () => {
      cameraRepo.find.mockResolvedValue([
        { cameraId: 'CAM-CSI-ST01-01' },
        { cameraId: 'CAM-CSI-ST01-02' },
      ]);
      expect(await createCsi()).toBe('CAM-CSI-ST01-03');
    });

    // Prefix chứa cả loại camera nên CSI và IP đánh số độc lập nhau.
    it('camera IP cùng trạm được đánh số riêng, không nối tiếp dãy CSI', async () => {
      cameraRepo.find.mockResolvedValue([
        { cameraId: 'CAM-CSI-ST01-01' },
        { cameraId: 'CAM-CSI-ST01-02' },
      ]);
      cameraRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeCamera());

      await service.create({
        gatewayId: 'GTW-ST01-TX2A',
        cameraType: 'IP',
        name: 'Cam IP',
        streamUrl: 'rtsp://10.0.0.1/stream',
      } as any);

      expect(cameraRepo.create.mock.calls[0][0].cameraId).toBe('CAM-IP-ST01-01');
    });

    it('trạm chưa load được thì suy mã từ khoá ngoại', async () => {
      gatewayService.findById.mockResolvedValue(
        makeGateway({ id: 1, station: undefined, stationRefId: 7 }),
      );
      cameraRepo.find.mockResolvedValue([]);
      cameraRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeCamera());

      await service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'CSI', name: 'C' } as any);

      expect(cameraRepo.create.mock.calls[0][0].cameraId).toBe('CAM-CSI-ST07-01');
    });

    it('mã tự truyền sai chuẩn → BadRequest', async () => {
      await expect(
        service.create({
          gatewayId: 'GTW-ST01-TX2A',
          cameraType: 'CSI',
          name: 'Cam',
          cameraId: 'CAM-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('mã đã tồn tại → Conflict', async () => {
      cameraRepo.find.mockResolvedValue([]);
      cameraRepo.findOne.mockResolvedValue(makeCamera());

      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'CSI', name: 'Cam' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('camera IP không được phép xoá trắng streamUrl', async () => {
      cameraRepo.findOne.mockResolvedValue(
        makeCamera({ cameraType: 'IP', streamUrl: 'rtsp://old' }),
      );

      await expect(service.update('CAM-IP-ST01-01', { streamUrl: '' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('không gửi streamUrl thì giữ giá trị cũ, không bị chặn', async () => {
      cameraRepo.findOne.mockResolvedValue(
        makeCamera({ cameraType: 'IP', streamUrl: 'rtsp://old' }),
      );

      await expect(service.update('CAM-IP-ST01-01', { name: 'Tên mới' } as any)).resolves.toBeDefined();
    });

    it('camera không tồn tại → NotFound', async () => {
      cameraRepo.findOne.mockResolvedValue(null);
      await expect(service.update('CAM-CSI-ST01-99', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('đồng bộ cấu hình xuống Jetson TX2', () => {
    it('tạo camera → publish lại config cho gateway', async () => {
      cameraRepo.find.mockResolvedValue([]);
      cameraRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeCamera());

      await service.create({ gatewayId: 'GTW-ST01-TX2A', cameraType: 'CSI', name: 'Cam' } as any);

      expect(gatewayService.publishGatewayConfig).toHaveBeenCalledWith('GTW-ST01-TX2A');
    });

    // Đổi gateway thì cả thiết bị cũ lẫn mới đều phải nhận config mới,
    // nếu không gateway cũ vẫn tưởng nó còn quản camera đó.
    it('đổi gateway → publish cho CẢ gateway cũ và mới', async () => {
      const oldGw = makeGateway({ id: 1, gatewayId: 'GTW-ST01-TX2A' });
      const newGw = makeGateway({ id: 2, gatewayId: 'GTW-ST02-TX2A' });
      cameraRepo.findOne
        .mockResolvedValueOnce(makeCamera({ gateway: oldGw }))
        .mockResolvedValue(makeCamera({ gateway: newGw }));
      gatewayService.findById.mockResolvedValue(newGw);

      await service.update('CAM-CSI-ST01-01', { gatewayId: 'GTW-ST02-TX2A' } as any);

      const published = gatewayService.publishGatewayConfig.mock.calls.map((c) => c[0]);
      expect(published).toEqual(expect.arrayContaining(['GTW-ST01-TX2A', 'GTW-ST02-TX2A']));
    });

    it('xoá camera → publish lại config', async () => {
      cameraRepo.findOne.mockResolvedValue(makeCamera({ gateway }));

      await service.delete('CAM-CSI-ST01-01');

      expect(gatewayService.publishGatewayConfig).toHaveBeenCalledWith('GTW-ST01-TX2A');
    });

    // MQTT hỏng không được làm hỏng thao tác CRUD — publish là fire-and-forget.
    it('lỗi publish MQTT không làm hỏng thao tác xoá', async () => {
      cameraRepo.findOne.mockResolvedValue(makeCamera({ gateway }));
      gatewayService.publishGatewayConfig.mockRejectedValue(new Error('MQTT down'));

      await expect(service.delete('CAM-CSI-ST01-01')).resolves.toEqual({ ok: true });
    });
  });

  describe('findById', () => {
    it('không tồn tại → NotFound kèm mã camera', async () => {
      cameraRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('CAM-CSI-ST01-99')).rejects.toThrow(
        'Camera "CAM-CSI-ST01-99" không tồn tại.',
      );
    });
  });
});
