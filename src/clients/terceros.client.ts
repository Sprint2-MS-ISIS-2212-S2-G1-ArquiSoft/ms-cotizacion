import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, fetch } from 'undici';


const TIMEOUT_SIN_TACTICAS_MS = 5000;

interface RespuestaScore {
  score: number;
}


export class TercerosNoDisponibleError extends Error {}


@Injectable()
export class TercerosClient implements OnModuleDestroy {
  private readonly logger = new Logger(TercerosClient.name);
  private readonly poolTerceros: Agent;
  readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    const resiliencia =
      this.config.get<string>('RESILIENCIA_HABILITADA', 'true') === 'true';
    this.timeoutMs = resiliencia
      ? Number(this.config.get<string>('TERCEROS_TIMEOUT_MS', '300'))
      : TIMEOUT_SIN_TACTICAS_MS;

    this.poolTerceros = new Agent({
      connections: Number(this.config.get<string>('BULKHEAD_CONEXIONES', '20')),
      keepAliveTimeout: 30_000,
    });
  }

  async obtenerScore(documento: string, socioId?: string): Promise<number> {
    const baseUrl = this.config.get<string>('TERCEROS_URL');
    if (!baseUrl) {
      throw new TercerosNoDisponibleError('Falta TERCEROS_URL');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (socioId) {
      headers['X-Socio-Id'] = socioId;
    }

    let respuesta: Awaited<ReturnType<typeof fetch>>;
    try {
      respuesta = await fetch(`${baseUrl}/open-data/scores`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ documento }),
        signal: AbortSignal.timeout(this.timeoutMs),
        dispatcher: this.poolTerceros,
      });
    } catch (error) {
      this.logger.warn(`Terceros no respondio: ${String(error)}`);
      throw new TercerosNoDisponibleError(String(error));
    }

    if (!respuesta.ok) {
      await respuesta.text().catch(() => undefined);
      this.logger.warn(`Terceros respondio ${respuesta.status}`);
      throw new TercerosNoDisponibleError(`HTTP ${respuesta.status}`);
    }

    const cuerpo = (await respuesta.json()) as RespuestaScore;
    return cuerpo.score;
  }

  async onModuleDestroy(): Promise<void> {
    await this.poolTerceros.close();
  }
}