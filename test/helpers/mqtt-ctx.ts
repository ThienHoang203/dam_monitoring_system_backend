/**
 * MqttContext giả cho test các `@MessagePattern` trong SensorController.
 *
 * Handler chỉ đọc topic qua `context.getTopic()` rồi tách bằng `split('/')`,
 * nên gọi thẳng method của controller với context này là đủ — không cần broker.
 */
import { MqttContext } from '@nestjs/microservices';

export function makeMqttContext(topic: string, packet: any = {}): MqttContext {
  return {
    getTopic: () => topic,
    getPacket: () => packet,
    getArgs: () => [topic, packet],
    getArgByIndex: (i: number) => [topic, packet][i],
    getPattern: () => topic,
  } as unknown as MqttContext;
}
