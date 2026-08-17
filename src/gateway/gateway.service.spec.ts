import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';
import { createConfigService } from '../../test/helpers/exec-context';
import { makeCamera, makeGateway, makeNode, makeStation } from '../../test/helpers/factories';
import { mqttClientMock, resetMqttMock, findPublishes } from '../../test/mocks/mqtt.mock';

/**
 * Gateway là cầu nối tới Jetson TX2 ngoài hiện trường. Hai thứ phải đúng tuyệt đối:
 *  - Cấu hình publish lên MQTT (retained) để thiết bị nhận được kể cả khi khởi động sau.
 *  - Heartbeat: gateway mất tín hiệu quá 30 giây phải chuyển offline.
 */
describe('GatewayService', () => {
  let gatewayRepo: MockRepo;
  let stationRepo: MockRepo;
  let auditLogService: { logAction: jest.Mock };
  let service: GatewayService;

  const build = (config: Record<string, any> = {}) => {
    gatewayRepo = createMockRepo();
    stationRepo = createMockRepo();
    auditLogService = { logAction: jest.fn().mockResolvedValue(null) };
    const s = new GatewayService(
      gatewayRepo as any,
      stationRepo as any,
      createConfigService(config),
      auditLogService as any,
    );
    s.onModuleInit(); // gắn mqttClient (đã được mock ở cấp module)
    return s;
  };

  beforeEach(() => {
    resetMqttMock();
    service = build();
  });

  describe('nextGatewayId — dải mã TX2A–TX2Z', () => {
    it('trạm chưa có gateway → TX2A', async () => {
      gatewayRepo.findOne.mockResolvedValue(null);
      await expect(service.nextGatewayId(makeStation({ stationCode: 'ST01' }))).resolves.toBe(
        'GTW-ST01-TX2A',
      );
    });

    it('TX2A đã dùng → cấp TX2B', async () => {
      gatewayRepo.findOne
        .mockResolvedValueOnce(makeGateway())
        .mockResolvedValueOnce(null);
      await expect(service.nextGatewayId(makeStation({ stationCode: 'ST01' }))).resolves.toBe(
        'GTW-ST01-TX2B',
      );
    });

    it('cạn cả 26 chữ cái → Conflict', async () => {
      gatewayRepo.findOne.mockResolvedValue(makeGateway());
      await expect(service.nextGatewayId(makeStation({ stationCode: 'ST01' }))).rejects.toThrow(
        ConflictException,
      );
    });

    it('trạm thiếu stationCode thì suy từ khoá chính', async () => {
      gatewayRepo.findOne.mockResolvedValue(null);
      await expect(
        service.nextGatewayId(makeStation({ stationCode: null as any, id: 7 })),
      ).resolves.toBe('GTW-ST07-TX2A');
    });
  });

  describe('resolveStation', () => {
    it('trạm không tồn tại → NotFound', async () => {
      stationRepo.findOne.mockResolvedValue(null);
      await expect(service.resolveStation('STA-999-99')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getGatewayConfig — hợp đồng dữ liệu với Jetson TX2', () => {
    it('gateway không tồn tại → NotFound', async () => {
      gatewayRepo.findOne.mockResolvedValue(null);
      await expect(service.getGatewayConfig('GTW-ST01-TX2A')).rejects.toThrow(NotFoundException);
    });

    it('map node kèm camera được gán và ngưỡng rung', async () => {
      const camera = makeCamera({ cameraId: 'CAM-CSI-ST01-01' });
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({
          nodes: [
            makeNode({
              nodeId: 'NOD-GW01-ESP01',
              mappedCamera: camera,
              warnHigh: 3,
              vibrationThreshold: 16,
              criticalHigh: 26,
              alertMinCount: 5,
            }),
          ],
          cameras: [camera],
        }),
      );

      const config = await service.getGatewayConfig('GTW-ST01-TX2A');

      expect(config.nodes['NOD-GW01-ESP01']).toEqual({
        camera_id: 'CAM-CSI-ST01-01',
        warn_high: 3,
        alert_high: 16,
        critical_high: 26,
        alert_min_count: 5,
        alert_min_duration_sec: 6,
        episode_reset_gap_sec: 3,
      });
    });

    it('node chưa gán camera → camera_id null', async () => {
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({ nodes: [makeNode({ mappedCamera: undefined })], cameras: [] }),
      );

      const config = await service.getGatewayConfig('GTW-ST01-TX2A');
      expect(config.nodes['NOD-GW01-ESP01'].camera_id).toBeNull();
    });

    it('field ngưỡng null được thay bằng giá trị mặc định của hợp đồng', async () => {
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({
          nodes: [
            makeNode({
              warnHigh: null,
              vibrationThreshold: null,
              criticalHigh: null,
              alertMinCount: null,
            }),
          ],
          cameras: [],
        }),
      );

      expect((await service.getGatewayConfig('GTW-ST01-TX2A')).nodes['NOD-GW01-ESP01']).toMatchObject({
        warn_high: 2.5,
        alert_high: 15.0,
        critical_high: 25.0,
        alert_min_count: 4,
      });
    });

    // Camera CSI cắm trực tiếp vào Jetson, không có URL. Trả stream_url: null sẽ khiến
    // firmware hiểu nhầm là có luồng — nên khoá phải vắng mặt hoàn toàn.
    it('camera CSI KHÔNG có khoá stream_url, camera IP thì có', async () => {
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({
          nodes: [],
          cameras: [
            makeCamera({ cameraId: 'CAM-CSI-ST01-01', cameraType: 'CSI', streamUrl: null }),
            makeCamera({
              cameraId: 'CAM-IP-ST01-01',
              cameraType: 'IP',
              streamUrl: 'rtsp://10.0.0.1/s',
            }),
          ],
        }),
      );

      const { cameras } = await service.getGatewayConfig('GTW-ST01-TX2A');

      expect(cameras['CAM-CSI-ST01-01']).toEqual({ camera_type: 'CSI' });
      expect('stream_url' in cameras['CAM-CSI-ST01-01']).toBe(false);
      expect(cameras['CAM-IP-ST01-01']).toEqual({
        camera_type: 'IP',
        stream_url: 'rtsp://10.0.0.1/s',
      });
    });
  });

  describe('publishGatewayConfig', () => {
    beforeEach(() => {
      gatewayRepo.findOne.mockResolvedValue(makeGateway({ nodes: [], cameras: [] }));
    });

    it('publish retained lên đúng topic với QoS 1', async () => {
      await service.publishGatewayConfig('GTW-ST01-TX2A');

      const calls = findPublishes('config/gateway/GTW-ST01-TX2A/update');
      expect(calls).toHaveLength(1);
      // retain: true để Jetson khởi động sau vẫn nhận được cấu hình hiện hành.
      expect(calls[0].opts).toEqual({ qos: 1, retain: true });
      expect(JSON.parse(calls[0].payload)).toEqual({ nodes: {}, cameras: {} });
    });

    it('chưa kết nối broker thì im lặng bỏ qua, không ném lỗi', async () => {
      mqttClientMock.connected = false;

      await expect(service.publishGatewayConfig('GTW-ST01-TX2A')).resolves.toBeUndefined();
      expect(mqttClientMock.publish).not.toHaveBeenCalled();
    });

    it('lỗi khi dựng config bị nuốt, không làm hỏng CRUD gọi nó', async () => {
      gatewayRepo.findOne.mockRejectedValue(new Error('DB down'));
      await expect(service.publishGatewayConfig('GTW-ST01-TX2A')).resolves.toBeUndefined();
    });
  });

  describe('validateGatewayApiKey', () => {
    it('chưa cấu hình key → bỏ qua kiểm tra (tương thích ngược)', () => {
      expect(() => build().validateGatewayApiKey(undefined)).not.toThrow();
    });

    it('đã cấu hình + key sai → Unauthorized', () => {
      const s = build({ GATEWAY_API_KEY: 'secret' });
      expect(() => s.validateGatewayApiKey('wrong')).toThrow(UnauthorizedException);
      expect(() => s.validateGatewayApiKey(undefined)).toThrow(UnauthorizedException);
    });

    it('đã cấu hình + key đúng → cho qua', () => {
      expect(() => build({ GATEWAY_API_KEY: 'secret' }).validateGatewayApiKey('secret')).not.toThrow();
    });
  });

  describe('heartbeat — phát hiện gateway mất kết nối', () => {
    const now = new Date('2026-01-01T12:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(now);
    });
    afterEach(() => jest.useRealTimers());

    const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

    it('quá 30 giây không có tín hiệu → chuyển offline', async () => {
      gatewayRepo.find.mockResolvedValue([
        makeGateway({ id: 1, status: 'online', lastSeenAt: secondsAgo(31) }),
      ]);

      await service.handleGatewayHeartbeatCheck();

      expect(gatewayRepo.update).toHaveBeenCalledWith(1, { status: 'offline' });
    });

    it('còn trong 30 giây thì giữ online', async () => {
      gatewayRepo.find.mockResolvedValue([
        makeGateway({ id: 1, status: 'online', lastSeenAt: secondsAgo(29) }),
      ]);

      await service.handleGatewayHeartbeatCheck();

      expect(gatewayRepo.update).not.toHaveBeenCalled();
    });

    it('chưa từng gửi tín hiệu → coi như offline', async () => {
      gatewayRepo.find.mockResolvedValue([
        makeGateway({ id: 1, status: 'online', lastSeenAt: null }),
      ]);

      await service.handleGatewayHeartbeatCheck();

      expect(gatewayRepo.update).toHaveBeenCalledWith(1, { status: 'offline' });
    });

    // Cron chạy 10 giây một lần — một lần lỗi DB không được phép làm chết job.
    it('lỗi truy vấn DB không làm chết cron', async () => {
      gatewayRepo.find.mockRejectedValue(new Error('DB down'));
      await expect(service.handleGatewayHeartbeatCheck()).resolves.toBeUndefined();
    });
  });
});
