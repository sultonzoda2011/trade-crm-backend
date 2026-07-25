import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto, marketId?: string) {
    if (!marketId) throw new UnauthorizedException('User is not assigned to a market')
    const existing = await this.prisma.category.findFirst({ where: { marketId, name: dto.name } })
    if (existing) throw new ConflictException('Category with this name already exists')
    return this.prisma.category.create({ data: { ...dto, marketId } })
  }

  async findAll(marketId?: string) {
    return this.prisma.category.findMany({
      where: marketId ? { marketId } : {},
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    })
  }

  async findOne(id: string, marketId?: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!category) throw new NotFoundException('Category not found')
    if (marketId && category.marketId !== marketId) throw new NotFoundException('Category not found')
    return category
  }

  async update(id: string, dto: UpdateCategoryDto, marketId?: string) {
    await this.findOne(id, marketId)
    return this.prisma.category.update({ where: { id }, data: dto })
  }

  async remove(id: string, marketId?: string) {
    await this.findOne(id, marketId)
    // onDelete: Cascade у Category->Market не влияет на Product.categoryId
    // (там связь необязательная без cascade) — Prisma отвяжет товары от
    // категории только если явно передать это через изменение схемы;
    // здесь просто не даём удалить категорию, если у неё есть товары.
    const productsCount = await this.prisma.product.count({ where: { categoryId: id } })
    if (productsCount > 0) {
      throw new ConflictException('Cannot delete a category that still has products')
    }
    await this.prisma.category.delete({ where: { id } })
  }
}
