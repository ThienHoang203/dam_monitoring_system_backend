import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GatewayApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.configService.get<string>('GATEWAY_API_KEY');
    // Nếu trong .env không cấu hình GATEWAY_API_KEY -> cho phép đi qua ở dev mode
    if (!expectedKey || expectedKey.trim() === '') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey =
      request.headers['x-gateway-api-key'] ||
      request.query?.apiKey ||
      request.body?.apiKey;

    if (!apiKey || apiKey !== expectedKey) {
      throw new UnauthorizedException(
        'API Key của Gateway/Jetson TX2 không hợp lệ hoặc bị thiếu (header x-gateway-api-key)',
      );
    }

    return true;
  }
}
