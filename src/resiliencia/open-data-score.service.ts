import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { hostname } from 'node:os';
import { TercerosClient } from '../clients/terceros.client';
import { ScoreCacheService } from './score-cache.service';


export type OrigenScore = 'OPEN_DATA' | 'CACHE' | 'DEFECTO';

export interface ScoreConOrigen {
  score: number;
  origen: OrigenScore;
}

type ContadoresOrigen = Record<OrigenScore, number>;
const vacios = (): ContadoresOrigen => ({ OPEN_DATA: 0, CACHE: 0, DEFECTO: 0 });


@Injectable()
export class OpenDataScoreService implements OnModuleDestroy {
  private readonly logger = new Logger('ResilienciaOpenData');
  private readonly replica = hostname();
  private readonly habilitada: boolean;
  private readonly scorePorDefecto: number;
  private readonly breaker: CircuitBreaker<[string, string?], number>;
  private ventana = vacios();
  private readonly total = vacios();
  private readonly timer: NodeJS.Timeout;

  constructor(
    config: ConfigService,
    private readonly tercerosClient: TercerosClient,
    private readonly cache: ScoreCacheService,
  ) {
    this.habilitada =
      config.get<string>('RESILIENCIA_HABILITADA', 'true') === 'true';
    this.scorePorDefecto = Number(config.get<string>('SCORE_POR_DEFECTO', '0'));

    const ventanaMs = Number(config.get<string>('CB_VENTANA_MS', '10000'));
    this.breaker = new CircuitBreaker(
      (documento: string, socioId?: string): Promise<number> =>
        this.tercerosClient.obtenerScore(documento, socioId),
      {

        timeout: false,
        errorThresholdPercentage: Number(
          config.get<string>('CB_UMBRAL_ERROR_PCT', '50'),
        ),
        volumeThreshold: Number(config.get<string>('CB_VOLUMEN_MINIMO', '5')),
        rollingCountTimeout: ventanaMs,
        rollingCountBuckets: 10,
        resetTimeout: Number(
          config.get<string>('CB_ESPERA_ABIERTO_MS', '30000'),
        ),
        capacity: Number(config.get<string>('BULKHEAD_CONCURRENCIA', '20')),
      },
    );


    this.breaker.on('open', () =>
      this.logger.warn(
        JSON.stringify({
          evento: 'breaker',
          estado: 'OPEN',
          replica: this.replica,
          ts: new Date().toISOString(),
        }),
      ),
    );
    this.breaker.on('halfOpen', () =>
      this.logger.warn(
        JSON.stringify({
          evento: 'breaker',
          estado: 'HALF_OPEN',
          replica: this.replica,
          ts: new Date().toISOString(),
        }),
      ),
    );
    this.breaker.on('close', () =>
      this.logger.warn(
        JSON.stringify({
          evento: 'breaker',
          estado: 'CLOSED',
          replica: this.replica,
          ts: new Date().toISOString(),
        }),
      ),
    );


    const segundos = Number(config.get<string>('METRICAS_INTERVALO_S', '10'));
    this.timer = setInterval(() => this.volcar(), segundos * 1000);
    this.timer.unref();

    this.logger.log(
      `Resiliencia ${this.habilitada ? 'HABILITADA' : 'DESHABILITADA (linea base)'}; timeout ${this.tercerosClient.timeoutMs} ms`,
    );
  }

  async obtenerScore(
    documento: string,
    socioId?: string,
  ): Promise<ScoreConOrigen> {
    if (!this.habilitada) {
      try {
        const score = await this.tercerosClient.obtenerScore(
          documento,
          socioId,
        );
        return this.contar({ score, origen: 'OPEN_DATA' });
      } catch {
        throw new ServiceUnavailableException(
          'Servicio Open Data no disponible',
        );
      }
    }

    try {
      const score = await this.breaker.fire(documento, socioId);
      await this.cache.guardar(documento, score);
      return this.contar({ score, origen: 'OPEN_DATA' });
    } catch (error) {
      const motivo = (error as { code?: string }).code ?? 'FALLO_TERCEROS';
      const enCache = await this.cache.leer(documento);
      if (enCache !== null) {
        this.logger.debug(`Score degradado desde cache (${motivo})`);
        return this.contar({ score: enCache, origen: 'CACHE' });
      }
      this.logger.debug(`Score por defecto (${motivo}, cliente sin cache)`);
      return this.contar({ score: this.scorePorDefecto, origen: 'DEFECTO' });
    }
  }

  estado() {
    return {
      replica: this.replica,
      resilienciaHabilitada: this.habilitada,
      timeoutTercerosMs: this.tercerosClient.timeoutMs,
      breaker: this.estadoBreaker(),
      origenScoreAcumulado: this.total,
    };
  }

  private estadoBreaker(): 'OPEN' | 'HALF_OPEN' | 'CLOSED' | 'N/A' {
    if (!this.habilitada) return 'N/A';
    if (this.breaker.opened) return 'OPEN';
    if (this.breaker.halfOpen) return 'HALF_OPEN';
    return 'CLOSED';
  }

  private contar(resultado: ScoreConOrigen): ScoreConOrigen {
    this.ventana[resultado.origen]++;
    this.total[resultado.origen]++;
    return resultado;
  }

  private volcar(): void {
    const v = this.ventana;
    if (v.OPEN_DATA + v.CACHE + v.DEFECTO === 0) return;
    this.logger.log(
      JSON.stringify({
        metrica: 'cotizacion',
        replica: this.replica,
        ts: new Date().toISOString(),
        breaker: this.estadoBreaker(),
        origenScore: v,
      }),
    );
    this.ventana = vacios();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.breaker.shutdown();
  }
}