import { BadRequestException, ConflictException } from '@nestjs/common';
import { NodeService } from './node.service';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';
import { priv } from '../../test/helpers/build-sensor-service';
import { makeGateway, makeNode, makeStation, makeThresholdConfig } from '../../test/helpers/factories';

/**
 * Sensor Node (ESP32) — mã thiết bị và ngưỡng rung được đồng bộ xuống Jetson TX2.
 * Ngưỡng sai thứ tự sẽ khiến firmware phân loại nhầm mức nguy hiểm.
 */
describe('NodeService', () => {
  let nodeRepo: MockRepo;
  let sensorRepo: MockRepo;
  let thresholdConfigRepo: MockRepo;
  let stationRepo: MockRepo;
  let gatewayService: any;
  let sensorService: any;
  let sensorGateway: any;
  let cameraService: any;
  let service: NodeService;

  beforeEach(() => {
    nodeRepo = createMockRepo();
    sensorRepo = createMockRepo();
    thresholdConfigRepo = createMockRepo();
    stationRepo = createMockRepo();
    gatewayService = {
      findById: jest.fn().mockResolvedValue(makeGateway({ id: 1 })),
      publishGatewayConfig: jest.fn().mockResolvedValue(undefined),
      nextGatewayId: jest.fn(),
      create: jest.fn(),
    };
    sensorService = {
      updateNodeStationMapping: jest.fn(),
      unregisterNode: jest.fn().mockResolvedValue(undefined),
      handleNodeStatusChanged: jest.fn().mockResolvedValue(undefined),
      drainStatusChanges: jest.fn().mockReturnValue([]),
      drainDamMetricChanges: jest.fn().mockReturnValue([]),
    };
    sensorGateway = {
      broadcastStationStatus: jest.fn(),
      broadcastDamMetrics: jest.fn(),
    };
    cameraService = { findById: jest.fn() };

    service = new NodeService(
      nodeRepo as any,
      sensorRepo as any,
      thresholdConfigRepo as any,
      stationRepo as any,
      gatewayService,
      sensorService,
      sensorGateway,
      cameraService,
      { logAction: jest.fn().mockResolvedValue(null) } as any,
    );
  });

  describe('validateThresholds — hợp đồng ngưỡng với firmware', () => {
    const validate = (...args: number[]) => () => priv(service).validateThresholds(...args);

    it('thứ tự đúng warn < alert < critical được chấp nhận', () => {
      expect(validate(2.5, 15, 25, 4, 3, 3)).not.toThrow();
    });

    it.each([
      [15, 15, 25, 'warn bằng alert'],
      [20, 15, 25, 'warn lớn hơn alert'],
      [2.5, 25, 25, 'alert bằng critical'],
      [2.5, 30, 25, 'alert lớn hơn critical'],
    ])('warn=%p alert=%p critical=%p bị từ chối (%s)', (w, a, c) => {
      expect(validate(w, a, c, 4, 3, 3)).toThrow(BadRequestException);
    });

    it('thông báo lỗi nêu đủ cả ba giá trị để người dùng sửa được', () => {
      expect(validate(20, 15, 25, 4, 3, 3)).toThrow(/20.*15.*25/);
    });

    it('alertMinCount phải từ 1 trở lên', () => {
      expect(validate(2.5, 15, 25, 0, 3, 3)).toThrow('alert_min_count phải >= 1.');
      expect(validate(2.5, 15, 25, 1, 3, 3)).not.toThrow();
    });

    it.each([
      [-1, 3, 'alertMinDurationSec âm'],
      [3, -1, 'episodeResetGapSec âm'],
    ])('thời lượng âm (%p, %p) bị từ chối (%s)', (duration, gap) => {
      expect(validate(2.5, 15, 25, 4, duration, gap)).toThrow(BadRequestException);
    });

    it('thời lượng bằng 0 là hợp lệ', () => {
      expect(validate(2.5, 15, 25, 4, 0, 0)).not.toThrow();
    });
  });

  describe('generatePlaceholderMac', () => {
    const gen = (seed: string) => priv(service).generatePlaceholderMac(seed);

    // MAC có ràng buộc UNIQUE — node thứ hai bỏ trống MAC sẽ lỗi trùng khoá
    // nếu dùng hằng số mặc định, nên phải sinh từ mã node.
    it('cùng mã node cho cùng MAC (ổn định giữa các lần chạy)', () => {
      expect(gen('NOD-GW01-ESP01')).toBe(gen('NOD-GW01-ESP01'));
    });

    it('mã node khác nhau cho MAC khác nhau', () => {
      expect(gen('NOD-GW01-ESP01')).not.toBe(gen('NOD-GW01-ESP02'));
    });

    // Octet đầu 0x02 = locally administered → không bao giờ đụng MAC thật của nhà sản xuất.
    it('octet đầu luôn là 02 (địa chỉ cục bộ)', () => {
      expect(gen('NOD-GW01-ESP01')).toMatch(/^02:/);
    });

    it('đúng định dạng MAC 6 octet viết hoa', () => {
      expect(gen('NOD-GW01-ESP01')).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    });
  });

  describe('nextNodeId — đánh số theo gateway', () => {
    const next = (gateway: any) => priv(service).nextNodeId(gateway);

    it('gateway chưa có node → NOD-GW01-ESP01', async () => {
      nodeRepo.find.mockResolvedValue([]);
      await expect(next(makeGateway({ id: 1 }))).resolves.toBe('NOD-GW01-ESP01');
    });

    it('đánh số tiếp theo mã lớn nhất', async () => {
      nodeRepo.find.mockResolvedValue([
        { nodeId: 'NOD-GW01-ESP01' },
        { nodeId: 'NOD-GW01-ESP02' },
      ]);
      await expect(next(makeGateway({ id: 1 }))).resolves.toBe('NOD-GW01-ESP03');
    });

    // Mã node gắn theo gateway.id (bất biến), không theo trạm — nhờ vậy mã không
    // "nói dối" khi gateway cha được chuyển sang trạm khác.
    it('node của gateway khác không ảnh hưởng dãy số', async () => {
      nodeRepo.find.mockResolvedValue([
        { nodeId: 'NOD-GW02-ESP01' },
        { nodeId: 'NOD-GW02-ESP02' },
      ]);
      await expect(next(makeGateway({ id: 1 }))).resolves.toBe('NOD-GW01-ESP01');
    });

    it('mã không parse được số thì bị bỏ qua', async () => {
      nodeRepo.find.mockResolvedValue([{ nodeId: 'NOD-GW01-ESPXX' }]);
      await expect(next(makeGateway({ id: 1 }))).resolves.toBe('NOD-GW01-ESP01');
    });

    it('gateway id nhiều chữ số vẫn đúng định dạng', async () => {
      nodeRepo.find.mockResolvedValue([]);
      await expect(next(makeGateway({ id: 12 }))).resolves.toBe('NOD-GW12-ESP01');
    });
  });

  describe('create — kế thừa ngưỡng cấp trạm', () => {
    beforeEach(() => {
      nodeRepo.find.mockResolvedValue([]);
      // Lời gọi đầu là kiểm tra trùng mã (phải null); các lời gọi sau là findById
      // để trả về bản ghi vừa lưu.
      nodeRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(makeNode());
      gatewayService.findById.mockResolvedValue(
        makeGateway({ id: 1, station: makeStation({ stationId: 'STA-001-01' }) }),
      );
    });

    // Node mới phải chạy đúng ngưỡng hiện hành của trạm, nếu không nó sẽ báo động
    // ở mức khác hẳn các node anh em cùng trạm.
    it('lấy ngưỡng rung từ ThresholdConfig của trạm khi DTO không khai', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(
        makeThresholdConfig({
          sensorType: 'vibration',
          warnHigh: 3.5,
          alertHigh: 18,
          criticalHigh: 30,
          sustainedSeconds: 5,
        }),
      );

      await service.create({ gatewayId: 'GTW-ST01-TX2A', name: 'Node 1' } as any);

      expect(nodeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          warnHigh: 3.5,
          vibrationThreshold: 18,
          criticalHigh: 30,
          alertMinDurationSec: 5,
        }),
      );
    });

    it('trạm chưa có cấu hình rung → dùng mặc định hệ thống', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(null);

      await service.create({ gatewayId: 'GTW-ST01-TX2A', name: 'Node 1' } as any);

      expect(nodeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ warnHigh: 2.5, vibrationThreshold: 15.0, criticalHigh: 25.0 }),
      );
    });

    it('giá trị khai trong DTO thắng cả cấu hình trạm lẫn mặc định', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(
        makeThresholdConfig({ sensorType: 'vibration', warnHigh: 3.5, alertHigh: 18 }),
      );

      await service.create({
        gatewayId: 'GTW-ST01-TX2A',
        name: 'Node 1',
        warnHigh: 1,
        vibrationThreshold: 10,
        criticalHigh: 20,
      } as any);

      expect(nodeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ warnHigh: 1, vibrationThreshold: 10, criticalHigh: 20 }),
      );
    });

    it('mã node tự truyền sai chuẩn → BadRequest', async () => {
      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', name: 'N', nodeId: 'NODE-1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('mã node đã tồn tại → Conflict', async () => {
      // Gỡ hàng đợi `Once` của beforeEach để lời gọi ĐẦU TIÊN đã thấy node trùng.
      nodeRepo.findOne.mockReset();
      nodeRepo.findOne.mockResolvedValue(makeNode());
      await expect(
        service.create({ gatewayId: 'GTW-ST01-TX2A', name: 'N' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('ngưỡng sai thứ tự bị chặn trước khi ghi DB', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          gatewayId: 'GTW-ST01-TX2A',
          name: 'N',
          warnHigh: 20,
          vibrationThreshold: 10,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(nodeRepo.save).not.toHaveBeenCalled();
    });

    it('không khai MAC thì sinh MAC cục bộ từ mã node', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(null);

      await service.create({ gatewayId: 'GTW-ST01-TX2A', name: 'N' } as any);

      expect(nodeRepo.save.mock.calls[0][0].macAddress).toMatch(/^02:/);
    });
  });

  describe('heartbeat — phát hiện node mất kết nối', () => {
    const now = new Date('2026-01-01T12:00:00Z');

    beforeEach(() => jest.useFakeTimers().setSystemTime(now));
    afterEach(() => jest.useRealTimers());

    const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

    it('node im lặng quá 30 giây → offline và báo cho SensorService', async () => {
      nodeRepo.find.mockResolvedValue([
        makeNode({ id: 1, nodeId: 'NOD-GW01-ESP01', status: 'online', lastSeenAt: secondsAgo(31) }),
      ]);

      await service.handleHeartbeatCheck();

      expect(nodeRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'offline' }));
      expect(sensorService.handleNodeStatusChanged).toHaveBeenCalledWith(
        'NOD-GW01-ESP01',
        'offline',
      );
    });

    it('node còn tín hiệu trong 30 giây thì giữ nguyên', async () => {
      nodeRepo.find.mockResolvedValue([
        makeNode({ id: 1, status: 'online', lastSeenAt: secondsAgo(29) }),
      ]);

      await service.handleHeartbeatCheck();

      expect(nodeRepo.update).not.toHaveBeenCalled();
      expect(sensorService.handleNodeStatusChanged).not.toHaveBeenCalled();
    });

    it('lỗi DB không làm chết cron chạy mỗi 10 giây', async () => {
      nodeRepo.find.mockRejectedValue(new Error('DB down'));
      await expect(service.handleHeartbeatCheck()).resolves.toBeUndefined();
    });
  });
});
