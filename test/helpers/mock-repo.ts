/**
 * Factory tạo mock `Repository<T>` của TypeORM.
 *
 * Mọi service trong repo đều inject repository theo đúng một pattern
 * (`@InjectRepository(X) private readonly xRepo: Repository<X>`), nên một
 * factory duy nhất phủ được toàn bộ tầng service.
 */
import { Repository, ObjectLiteral } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

export type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>> & {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  remove: jest.Mock;
  count: jest.Mock;
  query: jest.Mock;
  createQueryBuilder: jest.Mock;
};

/**
 * QueryBuilder giả: mọi method builder trả về chính nó để chuỗi `.leftJoinAndSelect().andWhere()...`
 * hoạt động, còn các method kết thúc (`getMany`, `getOne`, `getRawMany`...) trả giá trị rỗng
 * mặc định và có thể override trong từng test.
 */
export function createMockQueryBuilder(overrides: Record<string, any> = {}) {
  const qb: any = {};
  const chainable = [
    'select', 'addSelect', 'from', 'leftJoin', 'leftJoinAndSelect', 'innerJoin',
    'innerJoinAndSelect', 'where', 'andWhere', 'orWhere', 'orderBy', 'addOrderBy',
    'groupBy', 'addGroupBy', 'having', 'andHaving', 'limit', 'offset', 'take', 'skip',
    'setParameter', 'setParameters', 'distinctOn', 'withDeleted', 'relation', 'of',
  ];
  for (const name of chainable) {
    qb[name] = jest.fn(() => qb);
  }

  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(undefined);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.execute = jest.fn().mockResolvedValue(undefined);

  Object.assign(qb, overrides);
  return qb;
}

export function createMockRepo<T extends ObjectLiteral = any>(
  overrides: Partial<Record<string, any>> = {},
): MockRepo<T> {
  const queryBuilder = createMockQueryBuilder();

  const repo: any = {
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findOneOrFail: jest.fn(),
    // `create()` thật chỉ dựng object trong bộ nhớ, không chạm DB — mô phỏng y hệt
    // để service nào dùng `repo.create(dto)` rồi `repo.save(entity)` vẫn chạy đúng.
    create: jest.fn((dto: any) => ({ ...dto })),
    // `save()` trả lại chính entity, thêm id giả nếu chưa có (giống hành vi thật).
    save: jest.fn((entity: any) =>
      Promise.resolve(
        Array.isArray(entity)
          ? entity
          : { id: entity?.id ?? 'generated-id', ...entity },
      ),
    ),
    insert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
    update: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    upsert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
    delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    remove: jest.fn((entity: any) => Promise.resolve(entity)),
    count: jest.fn().mockResolvedValue(0),
    exist: jest.fn().mockResolvedValue(false),
    query: jest.fn().mockResolvedValue([]),
    clear: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => queryBuilder),
    // Một số service dùng repo.manager.query(...) cho SQL thô (DownsamplerService).
    manager: {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: any) => cb({ query: jest.fn().mockResolvedValue([]) })),
    },
    metadata: { tableName: 'mock_table', columns: [] },
  };

  Object.assign(repo, overrides);
  return repo as MockRepo<T>;
}

/**
 * Sinh sẵn provider `{ provide: getRepositoryToken(Entity), useValue: createMockRepo() }`
 * cho danh sách entity — rút gọn phần khai báo providers dài dòng của SensorService (11 repo).
 */
export function mockRepoProviders(entities: Function[]): Array<{ provide: any; useValue: MockRepo }> {
  return entities.map((entity) => ({
    provide: getRepositoryToken(entity as any),
    useValue: createMockRepo(),
  }));
}
