import { DataSource, Repository } from 'typeorm';
import { createTestDataSource, truncateAll } from '../helpers/db';
import { Dam } from '../../src/dam/entities/dam.entity';
import { Station } from '../../src/dam/entities/station.entity';
import { Gateway } from '../../src/gateway/entities/gateway.entity';
import { Node } from '../../src/node/entities/node.entity';
import { Sensor } from '../../src/node/entities/sensor.entity';
import { Camera } from '../../src/camera/entities/camera.entity';
import { AlarmEvent } from '../../src/sensor/entities/alarm-event.entity';
import { ThresholdConfig } from '../../src/sensor/entities/threshold-config.entity';

/**
 * Kiểm tra hành vi THẬT của TypeORM trên Postgres: cascade, khoá duy nhất,
 * và @AfterLoad. Đây là những thứ mock repository không thể phản ánh đúng.
 */
describe('Quan hệ entity trên Postgres thật', () => {
  let ds: DataSource;
  let damRepo: Repository<Dam>;
  let stationRepo: Repository<Station>;
  let gatewayRepo: Repository<Gateway>;
  let nodeRepo: Repository<Node>;
  let sensorRepo: Repository<Sensor>;
  let cameraRepo: Repository<Camera>;

  beforeAll(async () => {
    ds = await createTestDataSource();
    damRepo = ds.getRepository(Dam);
    stationRepo = ds.getRepository(Station);
    gatewayRepo = ds.getRepository(Gateway);
    nodeRepo = ds.getRepository(Node);
    sensorRepo = ds.getRepository(Sensor);
    cameraRepo = ds.getRepository(Camera);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  /** Dựng nguyên cây thiết bị Đập → Trạm → Gateway → Node → Cảm biến + Camera. */
  async function seedTopology() {
    const dam = await damRepo.save(damRepo.create({ damId: 'DAM-001', name: 'Đập Test' }));
    const station = await stationRepo.save(
      stationRepo.create({
        stationId: 'STA-001-01',
        stationCode: 'ST01',
        name: 'Trạm 01',
        damRefId: dam.id,
      }),
    );
    const gateway = await gatewayRepo.save(
      gatewayRepo.create({
        gatewayId: 'GTW-ST01-TX2A',
        name: 'Jetson 01',
        macAddress: '02:AA:BB:CC:DD:01',
        stationRefId: station.id,
      }),
    );
    const camera = await cameraRepo.save(
      cameraRepo.create({
        cameraId: 'CAM-CSI-ST01-01',
        cameraType: 'CSI',
        name: 'Camera 01',
        gatewayRefId: gateway.id,
      }),
    );
    const node = await nodeRepo.save(
      nodeRepo.create({
        nodeId: 'NOD-GW01-ESP01',
        name: 'Node 01',
        macAddress: '02:11:22:33:44:01',
        gatewayRefId: gateway.id,
        mappedCameraRefId: camera.id,
      }),
    );
    const sensor = await sensorRepo.save(
      sensorRepo.create({
        sensorId: 'SNR-VIB-ESP01-I2C1',
        sensorType: 'VIB',
        nodeRefId: node.id,
      }),
    );
    return { dam, station, gateway, camera, node, sensor };
  }

  describe('xoá dây chuyền (CASCADE)', () => {
    it('xoá đập kéo theo toàn bộ cây thiết bị bên dưới', async () => {
      const { dam } = await seedTopology();

      await damRepo.delete(dam.id);

      expect(await stationRepo.count()).toBe(0);
      expect(await gatewayRepo.count()).toBe(0);
      expect(await nodeRepo.count()).toBe(0);
      expect(await sensorRepo.count()).toBe(0);
      expect(await cameraRepo.count()).toBe(0);
    });

    it('xoá trạm chỉ kéo theo nhánh của trạm đó', async () => {
      const { station, dam } = await seedTopology();

      await stationRepo.delete(station.id);

      expect(await damRepo.count()).toBe(1);
      expect(await gatewayRepo.count()).toBe(0);
      await expect(damRepo.findOneBy({ id: dam.id })).resolves.toBeTruthy();
    });

    // Camera bị xoá KHÔNG được kéo theo node đang trỏ tới nó — node chỉ mất
    // liên kết camera (onDelete: SET NULL), phần cứng vẫn còn ngoài hiện trường.
    it('xoá camera chỉ gỡ liên kết, node vẫn còn nguyên', async () => {
      const { camera, node } = await seedTopology();

      await cameraRepo.delete(camera.id);

      const reloaded = await nodeRepo.findOneBy({ id: node.id });
      expect(reloaded).toBeTruthy();
      expect(reloaded!.mappedCameraRefId).toBeNull();
    });
  });

  describe('dữ liệu lịch sử sống sót khi xoá thiết bị', () => {
    // AlarmEvent và StationStatusHistory CỐ Ý không đặt khoá ngoại: hồ sơ sự cố
    // phải còn nguyên kể cả khi trạm bị gỡ khỏi danh mục thiết bị.
    it('cảnh báo vẫn còn sau khi trạm bị xoá', async () => {
      const { station } = await seedTopology();
      const alarmRepo = ds.getRepository(AlarmEvent);
      await alarmRepo.save(
        alarmRepo.create({
          damId: 'DAM-001',
          sensorId: 'STA-001-01',
          sensorType: 'water_level',
          severity: 'ALERT',
          thresholdVal: 50,
          measuredVal: 52,
          stationId: 'STA-001-01',
        }),
      );

      await stationRepo.delete(station.id);

      expect(await alarmRepo.count()).toBe(1);
    });

    // ThresholdConfig cũng không có khoá ngoại → phải dọn tay trong DamService,
    // nếu không sẽ thành bản ghi mồ côi.
    it('cấu hình ngưỡng KHÔNG tự bị xoá theo trạm (phải dọn thủ công)', async () => {
      const { station } = await seedTopology();
      const thRepo = ds.getRepository(ThresholdConfig);
      await thRepo.save(
        thRepo.create({
          stationId: 'STA-001-01',
          damId: 'DAM-001',
          sensorType: 'water_level',
          warnLow: 0,
          warnHigh: 42.5,
          alertLow: 42.5,
          alertHigh: 50,
          criticalHigh: 55,
        }),
      );

      await stationRepo.delete(station.id);

      expect(await thRepo.count()).toBe(1);
    });
  });

  describe('@AfterLoad hydrateParentCodes', () => {
    // Đây là nguồn bug `undefined` phổ biến nhất trong repo: trường ảo damId /
    // stationId / gatewayId CHỈ có giá trị khi quan hệ cha đã được load.
    it('không load quan hệ → damId của trạm là undefined', async () => {
      await seedTopology();

      const station = await stationRepo.findOne({ where: { stationId: 'STA-001-01' } });

      expect(station!.damId).toBeUndefined();
    });

    it('load quan hệ dam → damId được điền', async () => {
      await seedTopology();

      const station = await stationRepo.findOne({
        where: { stationId: 'STA-001-01' },
        relations: { dam: true },
      });

      expect(station!.damId).toBe('DAM-001');
    });

    it('gateway cần load station mới có stationId', async () => {
      await seedTopology();

      const bare = await gatewayRepo.findOne({ where: { gatewayId: 'GTW-ST01-TX2A' } });
      const withRel = await gatewayRepo.findOne({
        where: { gatewayId: 'GTW-ST01-TX2A' },
        relations: { station: true },
      });

      expect(bare!.stationId).toBeUndefined();
      expect(withRel!.stationId).toBe('STA-001-01');
    });

    // mappedCamera khai eager: true nên tự động có ở cấp gốc — khác với các quan hệ khác.
    it('node có mappedCameraId ngay cả khi không khai relations (quan hệ eager)', async () => {
      await seedTopology();

      const node = await nodeRepo.findOne({ where: { nodeId: 'NOD-GW01-ESP01' } });

      expect(node!.mappedCameraId).toBe('CAM-CSI-ST01-01');
    });

    it('nhưng gatewayId của node vẫn cần khai relations tường minh', async () => {
      await seedTopology();

      const bare = await nodeRepo.findOne({ where: { nodeId: 'NOD-GW01-ESP01' } });
      const withRel = await nodeRepo.findOne({
        where: { nodeId: 'NOD-GW01-ESP01' },
        relations: { gateway: true },
      });

      expect(bare!.gatewayId).toBeUndefined();
      expect(withRel!.gatewayId).toBe('GTW-ST01-TX2A');
    });

    // Đúng hợp đồng mà GatewayService.getGatewayConfig phụ thuộc: camera_id lấy từ
    // node.mappedCameraId trong nhánh quan hệ LỒNG NHAU, nơi eager không tự áp dụng.
    it('quan hệ lồng nhau cần khai tường minh mappedCamera', async () => {
      await seedTopology();

      const gw = await gatewayRepo.findOne({
        where: { gatewayId: 'GTW-ST01-TX2A' },
        relations: { nodes: { mappedCamera: true }, cameras: true },
      });

      expect(gw!.nodes[0].mappedCameraId).toBe('CAM-CSI-ST01-01');
    });
  });

  describe('ràng buộc khoá duy nhất', () => {
    it.each([
      ['damId của đập', async () => {
        await damRepo.save(damRepo.create({ damId: 'DAM-001', name: 'A' }));
        await damRepo.save(damRepo.create({ damId: 'DAM-001', name: 'B' }));
      }],
      ['stationId của trạm', async () => {
        const dam = await damRepo.save(damRepo.create({ damId: 'DAM-001', name: 'A' }));
        await stationRepo.save(stationRepo.create({ stationId: 'STA-001-01', name: 'A', damRefId: dam.id }));
        await stationRepo.save(stationRepo.create({ stationId: 'STA-001-01', name: 'B', damRefId: dam.id }));
      }],
    ])('%s không được trùng', async (_label, act) => {
      await expect(act()).rejects.toMatchObject({ code: '23505' });
    });

    // MAC trùng chính là lý do NodeService phải sinh MAC cục bộ từ mã node
    // thay vì dùng một hằng số mặc định.
    it('macAddress của node không được trùng', async () => {
      const { gateway } = await seedTopology();

      await expect(
        nodeRepo.save(
          nodeRepo.create({
            nodeId: 'NOD-GW01-ESP02',
            name: 'Node 02',
            macAddress: '02:11:22:33:44:01', // trùng node đã có
            gatewayRefId: gateway.id,
          }),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
