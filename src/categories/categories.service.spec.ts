import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ROLES_KEY } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { CategoriesController } from './categories.controller'
import { CategoriesService } from './categories.service'

const owner = (marketId = 'market-1') =>
  ({ sub: 'u1', id: 'u1', email: 'o@x.com', name: 'Owner', role: Role.OWNER, marketId }) as any
const ownerNoMarket = () =>
  ({ sub: 'u2', id: 'u2', email: 'o2@x.com', name: 'Owner', role: Role.OWNER }) as any
const admin = () => ({ sub: 'a1', id: 'a1', email: 'a@x.com', name: 'Admin', role: Role.ADMIN }) as any
const seller = (marketId = 'market-1') =>
  ({ sub: 's1', id: 's1', email: 's@x.com', name: 'Seller', role: Role.SELLER, marketId }) as any

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  name: 'Напитки',
  description: null,
  image: null,
  color: 'blue',
  sortOrder: 0,
  marketId: 'market-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

describe('CategoriesService', () => {
  let service: CategoriesService
  let prisma: any
  let storage: any
  let markets: any
  let products: any

  beforeEach(() => {
    prisma = {
      category: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      },
      product: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    }
    storage = { save: jest.fn().mockResolvedValue('img-url'), replace: jest.fn(), delete: jest.fn() }
    markets = { findOne: jest.fn().mockResolvedValue({ id: 'market-1', name: 'M' }) }
    products = { findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }) }
    service = new CategoriesService(prisma, storage, markets, products)
  })

  describe('роли контроллера', () => {
    const rolesOf = (method: keyof CategoriesController) =>
      Reflect.getMetadata(ROLES_KEY, CategoriesController.prototype[method] as any) as Role[] | undefined

    it('читать могут все, в том числе продавец (нужно в выборе товара)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, CategoriesController)).toEqual(
        expect.arrayContaining([Role.ADMIN, Role.OWNER, Role.SELLER]),
      )
      for (const m of ['findAll', 'findOne', 'findOneFull'] as const) {
        expect(rolesOf(m)).toBeUndefined()
      }
    })

    it('менять категории продавцу нельзя (раньше было можно)', () => {
      for (const m of ['create', 'update', 'remove', 'reorder', 'summary'] as const) {
        expect(rolesOf(m)).toEqual([Role.ADMIN, Role.OWNER])
      }
    })
  })

  describe('IDOR: чужой рынок', () => {
    it('findOne: категория чужого рынка — NotFound, а не Forbidden', async () => {
      prisma.category.findUnique.mockResolvedValue(row({ marketId: 'market-2' }))
      await expect(service.findOne('cat-1', owner('market-1'))).rejects.toThrow(NotFoundException)
      await expect(service.findOne('cat-1', seller('market-1'))).rejects.toThrow(NotFoundException)
    })

    it('findOne: владелец без рынка не видит чужие категории', async () => {
      prisma.category.findUnique.mockResolvedValue(row())
      await expect(service.findOne('cat-1', ownerNoMarket())).rejects.toThrow(NotFoundException)
    })

    it('findOne: админ видит любой рынок', async () => {
      prisma.category.findUnique.mockResolvedValue(row({ marketId: 'market-9' }))
      await expect(service.findOne('cat-1', admin())).resolves.toMatchObject({ id: 'cat-1' })
    })

    it('findAll: фильтрует по рынку владельца; админ — без фильтра', async () => {
      await service.findAll({ page: 1, limit: 20 } as any, owner('market-1'))
      expect(prisma.category.findMany.mock.calls[0][0].where.marketId).toBe('market-1')

      prisma.category.findMany.mockClear()
      await service.findAll({ page: 1, limit: 20 } as any, admin())
      expect(prisma.category.findMany.mock.calls[0][0].where.marketId).toBeUndefined()
    })

    it('findAll: сотрудник без рынка не получает все рынки', async () => {
      await service.findAll({ page: 1, limit: 20 } as any, ownerNoMarket())
      expect(prisma.category.findMany.mock.calls[0][0].where.marketId).toBeTruthy()
    })
  })

  describe('findAll', () => {
    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([row(), row({ id: 'cat-2', name: 'Хлеб' })])
      prisma.category.count.mockResolvedValue(2)
      prisma.$queryRaw.mockResolvedValue([
        {
          categoryId: 'cat-1',
          activeCount: 4,
          archivedCount: 1,
          lowStockCount: 1,
          outOfStockCount: 2,
          stockValue: 1500,
        },
      ])
    })

    it('по умолчанию — порядок владельца, имя как тай-брейк', async () => {
      await service.findAll({ page: 1, limit: 20 } as any, owner())
      expect(prisma.category.findMany.mock.calls[0][0].orderBy).toEqual([
        { sortOrder: 'asc' },
        { name: 'asc' },
      ])
    })

    it('явная сортировка работает, левые поля игнорируются', async () => {
      await service.findAll({ sortBy: 'name', sortOrder: 'desc' } as any, owner())
      expect(prisma.category.findMany.mock.calls[0][0].orderBy[0]).toEqual({ name: 'desc' })

      prisma.category.findMany.mockClear()
      await service.findAll({ sortBy: 'marketId', sortOrder: 'desc' } as any, owner())
      expect(prisma.category.findMany.mock.calls[0][0].orderBy[0]).toEqual({ sortOrder: 'asc' })
    })

    it('_count.products — только активные; архивные отдельно; сумма — владельцу', async () => {
      const res = await service.findAll({ page: 1, limit: 20 } as any, owner())
      expect(res.data[0]).toMatchObject({
        _count: { products: 4 },
        archivedCount: 1,
        lowStockCount: 1,
        outOfStockCount: 2,
        stockValue: 1500,
      })
      // Категория без товаров — нули, а не undefined.
      expect(res.data[1]).toMatchObject({ _count: { products: 0 }, stockValue: 0 })
    })

    it('продавцу сумму остатка не отдаём', async () => {
      const res = await service.findAll({ page: 1, limit: 20 } as any, seller())
      expect(res.data[0]).not.toHaveProperty('stockValue')
      expect(res.data[0]._count.products).toBe(4)
    })

    it('hasProducts считает только активные товары', async () => {
      await service.findAll({ hasProducts: false } as any, owner())
      expect(prisma.category.findMany.mock.calls[0][0].where.products).toEqual({
        none: { isActive: true },
      })
    })
  })

  describe('create', () => {
    it('встаёт в конец списка', async () => {
      prisma.category.aggregate.mockResolvedValue({ _max: { sortOrder: 6 } })
      prisma.category.create.mockImplementation(({ data }: any) => Promise.resolve(row(data)))
      const res = await service.create({ name: 'Новая' } as any, undefined, owner())
      expect(prisma.category.create.mock.calls[0][0].data.sortOrder).toBe(7)
      expect(res.name).toBe('Новая')
    })

    it('первая категория получает 0', async () => {
      prisma.category.create.mockImplementation(({ data }: any) => Promise.resolve(row(data)))
      await service.create({ name: 'Первая' } as any, undefined, owner())
      expect(prisma.category.create.mock.calls[0][0].data.sortOrder).toBe(0)
    })

    it('дубль названия без учёта регистра — CATEGORY_NAME_TAKEN', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'other' })
      await expect(service.create({ name: 'напитки' } as any, undefined, owner())).rejects.toMatchObject({
        response: { code: 'CATEGORY_NAME_TAKEN' },
      })
      expect(prisma.category.findFirst.mock.calls[0][0].where.name).toEqual({
        equals: 'напитки',
        mode: 'insensitive',
      })
      expect(prisma.category.create).not.toHaveBeenCalled()
    })

    it('гонка двух одинаковых названий (P2002) тоже даёт CATEGORY_NAME_TAKEN', async () => {
      prisma.category.create.mockRejectedValue({ code: 'P2002' })
      await expect(service.create({ name: 'Новая' } as any, undefined, owner())).rejects.toBeInstanceOf(
        ConflictException,
      )
    })

    it('без рынка (админ) создать нельзя', async () => {
      await expect(service.create({ name: 'Новая' } as any, undefined, admin())).rejects.toThrow()
      expect(prisma.category.create).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue(row())
      prisma.category.update.mockImplementation(({ data }: any) => Promise.resolve(row(data)))
    })

    it('переименование в занятое имя — CATEGORY_NAME_TAKEN', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'other' })
      await expect(service.update('cat-1', { name: 'Хлеб' } as any, undefined, owner())).rejects.toMatchObject({
        response: { code: 'CATEGORY_NAME_TAKEN' },
      })
      // Саму категорию из проверки исключаем: сохранение с тем же именем не конфликтует.
      expect(prisma.category.findFirst.mock.calls[0][0].where.id).toEqual({ not: 'cat-1' })
    })

    it('пустой цвет и пустое описание очищают поля', async () => {
      await service.update('cat-1', { color: '', description: '  ' } as any, undefined, owner())
      const data = prisma.category.update.mock.calls[0][0].data
      expect(data.color).toBeNull()
      expect(data.description).toBeNull()
    })

    it('не переданные поля не трогаем', async () => {
      await service.update('cat-1', { name: 'Соки' } as any, undefined, owner())
      expect(prisma.category.update.mock.calls[0][0].data).toEqual({ name: 'Соки' })
    })

    it('чужую категорию править нельзя', async () => {
      prisma.category.findUnique.mockResolvedValue(row({ marketId: 'market-2' }))
      await expect(service.update('cat-1', { name: 'X' } as any, undefined, owner())).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('remove', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue(row({ image: 'cat.png' }))
    })

    it('пустую категорию удаляет и чистит картинку после транзакции', async () => {
      prisma.product.count.mockResolvedValue(0)
      const res = await service.remove('cat-1', {}, owner())
      expect(prisma.product.updateMany).not.toHaveBeenCalled()
      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } })
      expect(storage.delete).toHaveBeenCalledWith('cat.png')
      expect(res).toEqual({ movedProducts: 0, detachedProducts: 0 })
    })

    it('с товарами и без выбора — 409 CATEGORY_HAS_PRODUCTS с числом товаров', async () => {
      prisma.product.count.mockResolvedValue(3)
      await expect(service.remove('cat-1', {}, owner())).rejects.toMatchObject({
        response: { code: 'CATEGORY_HAS_PRODUCTS', details: { productsCount: 3 } },
      })
      expect(prisma.category.delete).not.toHaveBeenCalled()
      expect(storage.delete).not.toHaveBeenCalled()
    })

    it('moveTo: переносит ВСЕ товары (в том числе архивные) и удаляет', async () => {
      prisma.product.count.mockResolvedValue(3)
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-2' })
      const res = await service.remove('cat-1', { moveTo: 'cat-2' }, owner())
      expect(prisma.product.count).toHaveBeenCalledWith({ where: { categoryId: 'cat-1' } })
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat-1' },
        data: { categoryId: 'cat-2' },
      })
      expect(prisma.category.delete).toHaveBeenCalled()
      expect(res).toEqual({ movedProducts: 3, detachedProducts: 0 })
    })

    it('moveTo: цель ищем только в рынке удаляемой категории', async () => {
      prisma.product.count.mockResolvedValue(1)
      prisma.category.findFirst.mockResolvedValue(null)
      await expect(service.remove('cat-1', { moveTo: 'foreign' }, owner())).rejects.toThrow(NotFoundException)
      expect(prisma.category.findFirst.mock.calls[0][0].where).toEqual({
        id: 'foreign',
        marketId: 'market-1',
      })
      expect(prisma.product.updateMany).not.toHaveBeenCalled()
      expect(prisma.category.delete).not.toHaveBeenCalled()
    })

    it('moveTo самой себя — 400', async () => {
      prisma.product.count.mockResolvedValue(1)
      await expect(service.remove('cat-1', { moveTo: 'cat-1' }, owner())).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('detach: товары остаются без категории', async () => {
      prisma.product.count.mockResolvedValue(2)
      const res = await service.remove('cat-1', { detach: true }, owner())
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat-1' },
        data: { categoryId: null },
      })
      expect(res).toEqual({ movedProducts: 0, detachedProducts: 2 })
    })

    it('чужую категорию удалить нельзя', async () => {
      prisma.category.findUnique.mockResolvedValue(row({ marketId: 'market-2' }))
      await expect(service.remove('cat-1', { detach: true }, owner())).rejects.toThrow(NotFoundException)
      expect(prisma.category.delete).not.toHaveBeenCalled()
    })
  })

  describe('reorder', () => {
    it('названные встают первыми, остальные — после в прежнем порядке', async () => {
      prisma.category.findMany
        .mockResolvedValueOnce([
          { id: 'c', marketId: 'market-1' },
          { id: 'a', marketId: 'market-1' },
        ])
        .mockResolvedValueOnce([{ id: 'b' }, { id: 'd' }])
      prisma.category.update.mockResolvedValue({})
      const res = await service.reorder({ ids: ['c', 'a'] }, owner())
      const writes = prisma.category.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.sortOrder])
      expect(writes).toEqual([
        ['c', 0],
        ['a', 1],
        ['b', 2],
        ['d', 3],
      ])
      expect(res).toEqual({ updated: 4 })
    })

    it('чужой или несуществующий id — NotFound, ничего не пишем', async () => {
      prisma.category.findMany.mockResolvedValueOnce([{ id: 'a', marketId: 'market-1' }])
      await expect(service.reorder({ ids: ['a', 'foreign'] }, owner())).rejects.toThrow(NotFoundException)
      expect(prisma.category.update).not.toHaveBeenCalled()
      // Запрос ограничен рынком владельца.
      expect(prisma.category.findMany.mock.calls[0][0].where.marketId).toBe('market-1')
    })

    it('id из разных рынков (админ) — NotFound', async () => {
      prisma.category.findMany.mockResolvedValueOnce([
        { id: 'a', marketId: 'market-1' },
        { id: 'b', marketId: 'market-2' },
      ])
      await expect(service.reorder({ ids: ['a', 'b'] }, admin())).rejects.toThrow(NotFoundException)
      expect(prisma.category.update).not.toHaveBeenCalled()
    })

    it('админ может упорядочить категории одного рынка', async () => {
      prisma.category.findMany
        .mockResolvedValueOnce([{ id: 'a', marketId: 'market-9' }])
        .mockResolvedValueOnce([])
      prisma.category.update.mockResolvedValue({})
      await expect(service.reorder({ ids: ['a'] }, admin())).resolves.toEqual({ updated: 1 })
      expect(prisma.category.findMany.mock.calls[0][0].where.marketId).toBeUndefined()
      expect(prisma.category.findMany.mock.calls[1][0].where.marketId).toBe('market-9')
    })
  })

  describe('summary', () => {
    it('отдаёт число категорий и товары без категории', async () => {
      prisma.category.count.mockResolvedValue(5)
      prisma.$queryRaw.mockResolvedValue([
        { products: 40, stockValue: 90000, uncategorizedProducts: 3, uncategorizedValue: 1200 },
      ])
      await expect(service.summary(owner())).resolves.toEqual({
        categories: 5,
        products: 40,
        stockValue: 90000,
        uncategorizedProducts: 3,
        uncategorizedValue: 1200,
      })
      expect(prisma.category.count).toHaveBeenCalledWith({ where: { marketId: 'market-1' } })
    })
  })

  describe('findOneFull', () => {
    it('превью товаров и рынок запрашиваются в рамках рынка вызывающего', async () => {
      prisma.category.findUnique.mockResolvedValue(row())
      await service.findOneFull('cat-1', owner())
      expect(markets.findOne).toHaveBeenCalledWith('market-1', 'market-1')
      expect(products.findAll.mock.calls[0][1]).toBe('market-1')
    })
  })
})
