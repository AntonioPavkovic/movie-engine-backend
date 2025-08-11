import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleInit {
  constructor() {
    super({
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
    });
  }

  onModuleInit() {
    this.on('connect', () => {
      console.log('Connected to Redis');
    });

    this.on('error', (err) => {
      console.error('Redis connection error:', err);
    });
  }
}