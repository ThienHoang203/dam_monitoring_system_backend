import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SensorService } from '../sensor/sensor.service';
import { SensorSnapshot } from '../sensor/sensor.dto';

@WebSocketGateway({ cors: { origin: '*' }, transports: ['websocket'] })
export class SensorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly sensorService: SensorService) { }

  handleConnection(client: Socket) {
    const latest = this.sensorService.getLatest();
    const history = this.sensorService.getHistory();

    if (latest) client.emit('update', latest);
    client.emit('history', history);
  }

  handleDisconnect(_client: Socket) { }

  broadcastUpdate(snapshot: SensorSnapshot) {
    this.server.emit('update', snapshot);
  }
}