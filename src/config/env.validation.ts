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

  @IsString()
  JWT_REFRESH_SECRET: string

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m'

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d'

  @IsNumber()
  @IsOptional()
  PORT: number = 3000
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
