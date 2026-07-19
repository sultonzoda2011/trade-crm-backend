import { Global, Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { AllExceptionsFilter } from './filters/http-exception.filter'
import { TransformInterceptor } from './interceptors/transform.interceptor'
import { LoggingInterceptor } from './interceptors/logging.interceptor'
import { StorageService } from './services/storage.service'

@Global()
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    StorageService,
  ],
  exports: [StorageService],
})
export class CommonModule {}
