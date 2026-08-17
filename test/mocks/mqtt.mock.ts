/**
 * Mock cho package `mqtt`.
 *
 * GatewayService gọi `mqtt.connect()` ngay trong onModuleInit, không qua DI,
 * nên không stub được bằng provider — bắt buộc phải mock ở cấp module.
 */

export interface MqttClientMock {
  publish: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  on: jest.Mock;
  end: jest.Mock;
  removeAllListeners: jest.Mock;
  connected: boolean;
}

export const mqttClientMock: MqttClientMock = {
  // Chữ ký thật: publish(topic, payload, opts?, cb?) — gọi callback với null để
  // nhánh "publish thành công" trong GatewayService được thực thi.
  publish: jest.fn((_topic: string, _payload: any, opts?: any, cb?: any) => {
    const done = typeof opts === 'function' ? opts : cb;
    if (typeof done === 'function') done(null);
    return mqttClientMock;
  }),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  on: jest.fn(),
  end: jest.fn(),
  removeAllListeners: jest.fn(),
  connected: true,
};

export const mqttModuleMock = {
  connect: jest.fn(() => mqttClientMock),
};

/** Đưa mock về trạng thái mặc định (connected, không có lời gọi nào). */
export function resetMqttMock(): void {
  mqttClientMock.connected = true;
  mqttClientMock.publish.mockClear();
  mqttClientMock.subscribe.mockClear();
  mqttClientMock.on.mockClear();
  mqttClientMock.end.mockClear();
  mqttModuleMock.connect.mockClear();
}

/**
 * Lấy các lần publish lên một topic cụ thể.
 * Dùng để assert config sync: `findPublishes('config/gateway/GTW-.../update')`
 */
export function findPublishes(topic: string): Array<{ topic: string; payload: any; opts: any }> {
  return mqttClientMock.publish.mock.calls
    .filter((call) => call[0] === topic)
    .map((call) => ({ topic: call[0], payload: call[1], opts: call[2] }));
}
