import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { compare, hash } from 'bcrypt'
import { Express } from 'express'
import { StorageService } from '../common/services/storage.service'
import { PrismaService } from '../prisma/prisma.service'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

const PROFILE_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
	role: true,
	marketId: true,
	createdAt: true
} as const

@Injectable()
export class ProfileService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly storageService: StorageService
	) {}

	async getProfile(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: PROFILE_SELECT
		})
		if (!user) throw new NotFoundException('User not found')
		return user
	}

	async updateProfile(
		userId: string,
		dto: UpdateProfileDto,
		file?: Express.Multer.File
	) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		if (dto.email && dto.email !== user.email) {
			const existing = await this.prisma.user.findUnique({
				where: { email: dto.email }
			})
			if (existing) throw new ConflictException('Email already in use')
		}

		const data: any = {}
		if (dto.name !== undefined) data.name = dto.name
		if (dto.email !== undefined) data.email = dto.email

		if (file) {
			if (user.image) {
				await this.storageService.delete(user.image)
			}
			data.image = await this.storageService.save(file, 'users')
		}

		return this.prisma.user.update({
			where: { id: userId },
			data,
			select: PROFILE_SELECT
		})
	}

	async changePassword(userId: string, dto: ChangePasswordDto) {
		const user = await this.prisma.user.findUnique({ where: { id: userId } })
		if (!user) throw new NotFoundException('User not found')

		if (dto.newPassword !== dto.confirmPassword) {
			throw new BadRequestException(
				'New password and confirm password do not match'
			)
		}

		const isCurrentPasswordValid = await compare(dto.currentPassword, user.password)
		if (!isCurrentPasswordValid) {
			throw new BadRequestException('Current password is incorrect')
		}

		await this.prisma.$transaction(async tx => {
			await tx.user.update({
				where: { id: userId },
				data: { password: await hash(dto.newPassword, 10) }
			})

	
		})
	}
}