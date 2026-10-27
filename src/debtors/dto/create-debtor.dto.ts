import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'

export class CreateDebtorDto {
  @ApiProperty({ example: 'Ivan Petrov' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: '+992901234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  // Допускаем пробелы, скобки и дефисы из ручного ввода — сервис приведёт номер к цифрам.
  @Matches(/^\+?[\d\s()-]{7,24}$/, {
    message: 'Phone must contain 7-15 digits, optionally starting with +',
  })
  phone: string

  @ApiPropertyOptional({ example: 'Ряд 5, лавка 12', description: 'Free-form note for the seller' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  @ApiPropertyOptional({ example: 5000, description: 'Soft credit limit; the client warns when exceeded' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number

  @ApiPropertyOptional({ example: 14, description: 'Default repayment term in days for new debts' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  defaultDueDays?: number
}
