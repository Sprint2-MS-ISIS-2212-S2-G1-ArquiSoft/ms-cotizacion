import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

@Injectable()
export class ScoreCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ScoreCacheService.name);
  private readonly redis: Redis;
  private readonly ttlSegundos: number;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      {
        maxRetriesPerRequest: 1,
        commandTimeout: Number(
          this.config.get<string>('REDIS_TIMEOUT_MS', '50'),
        ),
        enableOfflineQueue: false,
      },
    );
    this.ttlSegundos = Number(
      this.config.get<string>('SCORE_CACHE_TTL_S', '604800'),
    );
    this.redis.on('error', (error) =>
      this.logger.error(`Error de conexion a Redis: ${String(error)}`),
    );
  }

  private clave(documento: string): string {
    const hash = createHash('sha256').update(documento).digest('hex');
    return `opendata:score:${hash}`;
  }

  async guardar(documento: string, score: number): Promise<void> {
    try {
      await this.redis.set(
        this.clave(documento),
        String(score),
        'EX',
        this.ttlSegundos,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el score en Redis: ${String(error)}`,
      );
    }
  }

  async leer(documento: string): Promise<number | null> {
    try {
      const valor = await this.redis.get(this.clave(documento));
      return valor === null ? null : Number(valor);
    } catch (error) {
      this.logger.warn(`No se pudo leer el score de Redis: ${String(error)}`);
      return null;
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}