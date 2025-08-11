import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException 
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;
    
    if (!apiKey) {
      throw new UnauthorizedException('API key is required. Please provide X-API-Key header.');
    }
    
    const validApiKey = this.configService.get<string>('API_KEY');
    
    if (!validApiKey) {
      console.warn('⚠️  No API_KEY configured in environment.');
      return true;
    }
    
    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API key provided.');
    }
    
    return true;
  }
}