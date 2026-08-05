import { ThrottlerStorage } from '@nestjs/throttler'
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'
import { PrismaService } from '../../prisma/prisma.service'

interface BucketRow {
	hits: number
	expiresAt: Date
	blockedUntil: Date | null
}

/**
 * Персистентное хранилище для @nestjs/throttler поверх Postgres.
 * Семантика повторяет встроенное in-memory хранилище:
 * - hits растёт только пока ключ не заблокирован;
 * - превышение limit ставит блок на blockDuration;
 * - по истечении окна счётчик сбрасывается;
 * - по истечении блокировки счётчик сбрасывается и сразу начинает заново.
 *
 * Вся логика выполняется одним атомарным INSERT ... ON CONFLICT, что делает
 * лимиты корректными при нескольких инстансах/в serverless-среде.
 */
export class PrismaThrottlerStorage implements ThrottlerStorage {
	constructor(private readonly prisma: PrismaService) {}

	async increment(
		key: string,
		ttl: number,
		limit: number,
		blockDuration: number,
		throttlerName: string
	): Promise<ThrottlerStorageRecord> {
		const compositeKey = `${throttlerName}:${key}`
		const expiresAt = new Date(Date.now() + ttl)
		const blockedUntil = new Date(Date.now() + blockDuration)

		const rows = await this.prisma.$queryRaw<BucketRow[]>`
			INSERT INTO "ThrottleBucket" ("key", "hits", "expiresAt", "blockedUntil")
			VALUES (${compositeKey}, 1, ${expiresAt}, ${1 > limit ? blockedUntil : null})
			ON CONFLICT ("key") DO UPDATE SET
				"hits" = CASE
					WHEN "ThrottleBucket"."blockedUntil" > NOW() THEN "ThrottleBucket"."hits"
					WHEN "ThrottleBucket"."expiresAt" <= NOW() THEN 1
					ELSE "ThrottleBucket"."hits" + 1
				END,
				"expiresAt" = CASE
					WHEN "ThrottleBucket"."expiresAt" <= NOW() THEN ${expiresAt}
					ELSE "ThrottleBucket"."expiresAt"
				END,
				"blockedUntil" = CASE
					WHEN "ThrottleBucket"."blockedUntil" > NOW() THEN "ThrottleBucket"."blockedUntil"
					WHEN (
						CASE
							WHEN "ThrottleBucket"."blockedUntil" > NOW() THEN "ThrottleBucket"."hits"
							WHEN "ThrottleBucket"."expiresAt" <= NOW() THEN 1
							ELSE "ThrottleBucket"."hits" + 1
						END
					) > ${limit} THEN ${blockedUntil}
					ELSE NULL
				END
			RETURNING "hits", "expiresAt", "blockedUntil"
		`

		const row = rows[0]
		const now = Date.now()
		const blockedUntilMs = row.blockedUntil
			? new Date(row.blockedUntil).getTime()
			: 0
		const isBlocked = blockedUntilMs > now

		return {
			totalHits: row.hits,
			timeToExpire: Math.max(
				0,
				Math.ceil((new Date(row.expiresAt).getTime() - now) / 1000)
			),
			isBlocked,
			timeToBlockExpire: isBlocked
				? Math.max(
						1,
						Math.ceil((blockedUntilMs - now) / 1000)
					)
				: 0
		}
	}
}
