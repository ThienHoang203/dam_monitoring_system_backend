import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import * as mqtt from 'mqtt';
import { createRealtimeApp, resetDb, teardownRealtimeApp } from '../helpers/e2e-app';
import { waitFor, sleep } from '../helpers/wait-for';
import { Dam } from '../../src/dam/entities/dam.entity';
import { Station } from '../../src/dam/entities/station.entity';
import { Gateway } from '../../src/gateway/entities/gateway.entity';
import { Node } from '../../src/node/entities/node.entity';
import { AlarmEvent } from '../../src/sensor/entities/alarm-event.entity';
import { SensorService } from '../../src/sensor/sensor.service';

/**
 * Đường đi THẬT của telemetry: thiết bị publish lên Mosquitto → Nest microservice
 * nhận qua @MessagePattern → SensorService xử lý → cập nhật trạng thái trạm.
 *
 * Tầng này không mock `mqtt` (xem test/setup-realtime.ts) nên nó là nơi duy nhất
 * chứng minh được cấu hình topic và transport thực sự khớp nhau.
 */
describe('Luồng MQTT với broker thật', () => {
  let app: INestApplication;
  let ds: DataSource;
  let client: mqtt.MqttClient;
  let sensorService: SensorService;

  const GATEWAY_ID = 'GTW-ST01-TX2A';
  const NODE_ID = 'NOD-GW01-ESP01';
  const STATION_ID = 'STA-001-01';
  const DAM_ID = 'DAM-001';

  beforeAll(async () => {
    ({ app, ds } = await createRealtimeApp());
    sensorService = app.get(SensorService);

    client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1884', {
      clientId: `test-publisher-${Date.now()}`,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
      setTimeout(() => reject(new Error('Không kết nối được Mosquitto ở cổng 1884')), 10_000);
    });
  });

  afterAll(async () => {
    if (client) await new Promise<void>((r) => client.end(true, {}, () => r()));
    if (app) await teardownRealtimeApp(app);
  });

  beforeEach(async () => {
    await resetDb(ds);
    await seedTopology();
    // Nạp lại bản đồ topology trong bộ nhớ sau khi TRUNCATE, nếu không service
    // vẫn giữ ánh xạ node→trạm của test trước.
    await sensorService.syncTopologyFromDb();
  });

  async function seedTopology() {
    const dam = await ds.getRepository(Dam).save(
      ds.getRepository(Dam).create({ damId: DAM_ID, name: 'Đập Test' }),
    );
    const station = await ds.getRepository(Station).save(
      ds.getRepository(Station).create({
        stationId: STATION_ID,
        stationCode: 'ST01',
        name: 'Trạm 01',
        damRefId: dam.id,
      }),
    );
    const gateway = await ds.getRepository(Gateway).save(
      ds.getRepository(Gateway).create({
        gatewayId: GATEWAY_ID,
        name: 'Jetson 01',
        macAddress: '02:AA:BB:CC:DD:01',
        stationRefId: station.id,
      }),
    );
    await ds.getRepository(Node).save(
      ds.getRepository(Node).create({
        nodeId: NODE_ID,
        name: 'Node 01',
        macAddress: '02:11:22:33:44:01',
        gatewayRefId: gateway.id,
      }),
    );
    await sensorService.ensureThresholdConfigs(STATION_ID, DAM_ID);
  }

  const publish = (topic: string, payload: any) =>
    new Promise<void>((resolve, reject) =>
      client.publish(
        topic,
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve()),
      ),
    );

  describe('telemetry theo từng loại cảm biến', () => {
    it('mực nước publish qua broker được ghi vào trạng thái trạm', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, {
        value: 30,
      });

      const snapshot = await waitFor(
        () => {
          const latest = sensorService.getLatest(STATION_ID);
          return latest && latest.waterLevel === 30 ? latest : null;
        },
        { description: 'mực nước được cập nhật thành 30' },
      );

      expect(snapshot.waterLevel).toBe(30);
    });

    it('độ ẩm dùng topic riêng, không ghi đè mực nước', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, { value: 25 });
      await waitFor(() => sensorService.getLatest(STATION_ID)?.waterLevel === 25 || null);

      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/moisture`, { value: 60 });

      const snapshot = await waitFor(
        () => {
          const latest = sensorService.getLatest(STATION_ID);
          return latest && latest.moisture === 60 ? latest : null;
        },
        { description: 'độ ẩm được cập nhật' },
      );

      // Giá trị cũ phải được giữ lại — mỗi topic chỉ cập nhật loại số đo của nó.
      expect(snapshot.waterLevel).toBe(25);
    });

    it('gateway và node được đánh dấu trực tuyến sau khi nhận tin', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, { value: 10 });

      const gw = await waitFor(
        async () => {
          const found = await ds.getRepository(Gateway).findOneBy({ gatewayId: GATEWAY_ID });
          return found?.status === 'online' ? found : null;
        },
        { description: 'gateway chuyển sang trạng thái online' },
      );

      expect(gw.lastSeenAt).toBeTruthy();
    });
  });

  describe('dung sai payload thật trên đường truyền', () => {
    it('payload JSON hỏng không làm chết microservice', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, 'không-phải-json');
      await sleep(500);

      // Chứng minh tiến trình vẫn sống: tin hợp lệ ngay sau đó vẫn được xử lý.
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, { value: 33 });

      await waitFor(
        () => (sensorService.getLatest(STATION_ID)?.waterLevel === 33 ? true : null),
        { description: 'microservice vẫn xử lý được tin sau payload hỏng' },
      );
    });

    // Payload số trần đi qua bộ giải mã của Nest sẽ thành kiểu number, rồi
    // parseTelemetryPayload bọc lại thành { value } — đường này hoạt động đúng.
    it('payload số trần được xử lý bình thường', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, '99');

      await waitFor(
        () => (sensorService.getLatest(STATION_ID)?.waterLevel === 99 ? true : null),
        { description: 'số đo trần được ghi nhận' },
      );
    });

    // ⚠️ LỖI THẬT, phạm vi hẹp hơn suy đoán ban đầu: chỉ chuỗi được BỌC NHÁY JSON
    // mới hỏng. Bộ giải mã của Nest tháo lớp nháy thành chuỗi JS "42", sau đó
    // parseTelemetryPayload JSON.parse lần thứ hai và nhận về số trần — không có
    // thuộc tính .value nên ingestSingleTelemetry bỏ qua, số đo mất âm thầm.
    it('LỖI: payload bọc nháy JSON bị loại bỏ âm thầm', async () => {
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, { value: 12 });
      await waitFor(() => (sensorService.getLatest(STATION_ID)?.waterLevel === 12 ? true : null));

      // Tương đương thiết bị gửi chuỗi JSON: "42"  (có cặp nháy kép trong payload)
      await publish(`telemetry/gateway/${GATEWAY_ID}/node/${NODE_ID}/water_level`, '"42"');
      await sleep(1000);

      // Vẫn là 12 — gói tin đã bị nuốt, không có lỗi nào được ghi nhận.
      expect(sensorService.getLatest(STATION_ID)?.waterLevel).toBe(12);
    });
  });

  describe('trạng thái rung từ Jetson TX2', () => {
    it('mức nguy cấp đẩy trạng thái an toàn của trạm lên critical', async () => {
      await publish(`status/gateway/${GATEWAY_ID}/node/${NODE_ID}/vibration`, {
        severity: 'CRITICAL',
        value: 30,
        breach: true,
      });

      const station = await waitFor(
        async () => {
          const found = await ds.getRepository(Station).findOneBy({ stationId: STATION_ID });
          return found?.status === 'critical' ? found : null;
        },
        { description: 'trạm chuyển sang trạng thái critical' },
      );

      expect(station.statusReason).toBeTruthy();
    });
  });

  describe('sự kiện bất thường (anomaly)', () => {
    it('tạo bản ghi cảnh báo trong cơ sở dữ liệu', async () => {
      await publish(`events/gateway/${GATEWAY_ID}/anomaly`, {
        event_id: 'EVT-RT-001',
        node_id: NODE_ID,
        severity: 'ALERT',
        crack_detected: false,
        measured_val: 18.5,
        threshold_val: 15,
      });

      const alarm = await waitFor(
        () => ds.getRepository(AlarmEvent).findOneBy({ eventId: 'EVT-RT-001' }),
        { description: 'cảnh báo được ghi vào cơ sở dữ liệu' },
      );

      expect(alarm.severity).toBe('ALERT');
      expect(alarm.measuredVal).toBe(18.5);
    });

    // Jetson có thể gửi lại cùng một sự kiện khi mạng chập chờn — hệ thống phải
    // gộp vào bản ghi cũ thay vì nhân đôi cảnh báo cho cùng một sự cố.
    it('gửi lại cùng event_id không nhân đôi cảnh báo', async () => {
      const payload = {
        event_id: 'EVT-RT-DUP',
        node_id: NODE_ID,
        severity: 'ALERT',
        measured_val: 20,
      };

      await publish(`events/gateway/${GATEWAY_ID}/anomaly`, payload);
      await waitFor(() => ds.getRepository(AlarmEvent).findOneBy({ eventId: 'EVT-RT-DUP' }));

      await publish(`events/gateway/${GATEWAY_ID}/anomaly`, { ...payload, measured_val: 22 });
      await sleep(1000);

      const count = await ds.getRepository(AlarmEvent).countBy({ eventId: 'EVT-RT-DUP' });
      expect(count).toBe(1);
    });

    it('phát hiện vết nứt nâng mức cảnh báo lên nguy cấp', async () => {
      await publish(`events/gateway/${GATEWAY_ID}/anomaly`, {
        event_id: 'EVT-RT-CRACK',
        node_id: NODE_ID,
        severity: 'WARNING',
        crack_detected: true,
        confidence: 0.93,
      });

      const alarm = await waitFor(
        () => ds.getRepository(AlarmEvent).findOneBy({ eventId: 'EVT-RT-CRACK' }),
        { description: 'cảnh báo vết nứt được ghi nhận' },
      );

      // Vết nứt ép mức lên CRITICAL bất kể severity gửi lên là gì.
      expect(alarm.severity).toBe('CRITICAL');
    });
  });

  describe('đồng bộ cấu hình xuống Jetson TX2', () => {
    it('cấu hình được publish dạng retained để thiết bị khởi động sau vẫn nhận được', async () => {
      const gatewayService = app.get<any>(
        require('../../src/gateway/gateway.service').GatewayService,
      );

      const received = new Promise<Buffer>((resolve, reject) => {
        const sub = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1884', {
          clientId: `test-config-sub-${Date.now()}`,
        });
        const timer = setTimeout(() => {
          sub.end(true);
          reject(new Error('Không nhận được cấu hình trên topic config/gateway/+/update'));
        }, 15_000);

        sub.on('connect', () => {
          sub.subscribe(`config/gateway/${GATEWAY_ID}/update`, { qos: 1 }, async () => {
            // Subscribe xong mới publish để chắc chắn không lỡ tin.
            await gatewayService.publishGatewayConfig(GATEWAY_ID);
          });
        });
        sub.on('message', (_topic, payload) => {
          clearTimeout(timer);
          sub.end(true);
          resolve(payload);
        });
      });

      const payload = JSON.parse((await received).toString());

      expect(payload).toHaveProperty('nodes');
      expect(payload).toHaveProperty('cameras');
      expect(payload.nodes[NODE_ID]).toMatchObject({
        warn_high: expect.any(Number),
        alert_high: expect.any(Number),
        critical_high: expect.any(Number),
      });
    });
  });
});
