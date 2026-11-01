import { plainToInstance } from 'class-transformer'
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator'

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development

  @IsString()
  DATABASE_URL: string

  @IsString()
  JWT_ACCESS_SECRET: string

 

  /**
   * Срок жизни токена. Refresh-токенов нет, а 401 на клиенте = выход, поэтому
   * короткий срок (15m) выкидывал бы людей посреди рабочего дня. По умолчанию —
   * год: человека, которого удалили, всё равно отсекает JwtStrategy (проверка
   * пользователя в БД раз в 60 секунд).
   */
  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '365d'


  @IsNumber()
  @IsOptional()
  BCRYPT_ROUNDS: number = 12

  @IsNumber()
  @IsOptional()
  PORT: number = 3000

  @IsString()
  CLOUDINARY_CLOUD_NAME: string

  @IsString()
  CLOUDINARY_API_KEY: string

  @IsString()
  CLOUDINARY_API_SECRET: string
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  })

  if (errors.length > 0) {
    throw new Error(errors.toString())
  }

  return validatedConfig
}