/**
 * Chờ một điều kiện thành hiện thực.
 *
 * MQTT và WebSocket là bất đồng bộ và không có phản hồi đồng bộ để await, nên
 * không thể assert ngay sau khi publish. Thay vì đặt sleep cố định (vừa chậm vừa
 * dễ vỡ trên máy chậm), ta hỏi lại điều kiện theo chu kỳ cho tới khi đạt hoặc hết giờ.
 */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined> | T | null | undefined,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const { timeoutMs = 10_000, intervalMs = 100, description = 'điều kiện' } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value as T;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `waitFor: quá ${timeoutMs}ms mà ${description} chưa xảy ra` +
      (lastError ? ` (lỗi gần nhất: ${(lastError as Error).message})` : ''),
  );
}

/** Chờ một sự kiện Socket.IO, kèm hạn chót để test không treo vô hạn. */
export function waitForEvent<T = any>(
  socket: { on: (event: string, cb: (payload: T) => void) => void; off?: Function },
  event: string,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForEvent: không nhận được sự kiện "${event}" trong ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.on(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
