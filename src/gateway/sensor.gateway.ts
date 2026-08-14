import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SensorService } from '../sensor/sensor.service';
import { SensorSnapshot } from '../sensor/sensor.dto';

@WebSocketGateway({
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: false },
  transports: ['websocket'],
})
export class SensorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly sensorService: SensorService) { }

  handleConnection(client: Socket) {
    const latest = this.sensorService.getLatest();
    const history = this.sensorService.getHistory();

    if (latest) client.emit('update', latest);
    client.emit('history', history);
  }

  handleDisconnect(_client: Socket) { }

  private lastBroadcastMap: Map<string, number> = new Map();
  private readonly THROTTLE_MS = 50; // Giới hạn tối đa 20 FPS qua WebSocket để dữ liệu mượt mà

  broadcastUpdate(snapshot: SensorSnapshot) {
    const key = snapshot.clusterId || (snapshot.stationId ? `st_${snapshot.stationId}` : 'default');
    const now = Date.now();
    const last = this.lastBroadcastMap.get(key) || 0;

    if (now - last >= this.THROTTLE_MS) {
      this.lastBroadcastMap.set(key, now);
      this.server.emit('update', snapshot);
    }
  }

  // Broadcast alarm event mới tới tất cả client
  broadcastAlarm(alarm: any) {
    this.server.emit('alarm', alarm);
  }

  // Broadcast trạng thái ngưỡng độ rung realtime (status/gateway/{id}/node/{id}/vibration)
  // cho dashboard vẽ biểu đồ ngưỡng, kể cả khi breach=false (NORMAL/WARNING).
  broadcastVibrationStatus(status: any) {
    this.server.emit('vibration_status', status);
  }
}
