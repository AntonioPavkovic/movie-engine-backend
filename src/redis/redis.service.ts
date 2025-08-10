import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public client: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.client = new Redis(redisUrl);
  }

  onModuleInit() {
    this.client.on('connect', () => console.log('Redis connected'));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
