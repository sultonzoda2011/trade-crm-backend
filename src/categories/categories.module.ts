import { Module } from '@nestjs/common'
import { CategoriesController } from './categories.controller'
import { CategoriesService } from './categories.service'
import { MarketsModule } from '../markets/markets.module'
import { ProductsModule } from '../products/products.module'

@Module({
  imports: [MarketsModule, ProductsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
