/**
 * ExecutionContext giả cho test guard.
 *
 * Guard trong repo chỉ dùng `switchToHttp().getRequest()`, `getHandler()` và `getClass()`,
 * nên không cần dựng context đầy đủ của Nest.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface FakeRequest {
  headers?: Record<string, any>;
  query?: Record<string, any>;
  body?: Record<string, any>;
  cookies?: Record<string, any>;
  user?: any;
  url?: string;
}

export function createExecutionContext(request: FakeRequest = {}): ExecutionContext {
  const req = {
    headers: {},
    query: {},
    body: {},
    cookies: {},
    ...request,
  };

  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function testHandler() {},
    getClass: () => class TestController {},
    getType: () => 'http',
    getArgs: () => [req],
    getArgByIndex: () => req,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getData: () => ({}), getClient: () => ({}) }),
  };

  return ctx as unknown as ExecutionContext;
}

/**
 * Reflector giả trả về metadata cố định.
 *
 * `metadata` map key -> giá trị, ví dụ `{ isPublic: true }` hoặc `{ roles: ['ADMIN'] }`.
 * Guard dùng `getAllAndOverride(key, [handler, class])` nên chỉ cần tra theo key.
 */
export function createReflector(metadata: Record<string, any> = {}): Reflector {
  return {
    get: jest.fn((key: string) => metadata[key]),
    getAll: jest.fn((key: string) => [metadata[key]]),
    getAllAndMerge: jest.fn((key: string) => metadata[key]),
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

/** ConfigService giả — chỉ cần `get(key, defaultValue?)`. */
export function createConfigService(values: Record<string, any> = {}) {
  return {
    get: jest.fn((key: string, defaultValue?: any) =>
      values[key] !== undefined ? values[key] : defaultValue,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing config ${key}`);
      return values[key];
    }),
  } as any;
}
