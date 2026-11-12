import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Timeout de toda llamada saliente hacia Terceros (regla 5 de CLAUDE.md). */
const TIMEOUT_MS = 5000;

interface RespuestaScore {
  score: number;
}

/**
 * Cliente HTTP hacia el microservicio terceros.
 *
 * En el monolito esto era una llamada en proceso a
 * TercerosService.getOpenDataScore(). Los reintentos, el backoff y el circuit
 * breaker (opossum) que ese mock traia NO se migran, y tampoco se guarda el
 * ultimo score en cache: son tacticas del ASR de Cotizacion y se agregan en
 * su propia rama. Aqui solo queda el timeout, que es obligatorio, y la
 * propagacion de X-Socio-Id.
 */
@Injectable()
export class TercerosClient {
  private readonly logger = new Logger(TercerosClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Consulta el score de Open Data del documento (entero 0-100).
   *
   * A diferencia del KYC, aqui no hay respuesta de negocio negativa: si
   * Terceros no contesta o contesta con error, no hay score con el que
   * cotizar, asi que todo fallo se traduce a 503.
   */
  async obtenerScore(documento: string, socioId?: string): Promise<number> {
    const baseUrl = this.config.get<string>('TERCEROS_URL');
    if (!baseUrl) {
      throw new ServiceUnavailableException('Servicio Open Data no disponible');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (socioId) {
      headers['X-Socio-Id'] = socioId;
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${baseUrl}/open-data/scores`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ documento }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout o conexion rechazada: Terceros no respondio.
      this.logger.error(
        `Terceros no respondio al consultar el score: ${String(error)}`,
      );
      throw new ServiceUnavailableException('Servicio Open Data no disponible');
    }

    if (!respuesta.ok) {
      this.logger.error(
        `Terceros respondio ${respuesta.status} al consultar el score`,
      );
      throw new ServiceUnavailableException('Servicio Open Data no disponible');
    }

    const cuerpo = (await respuesta.json()) as RespuestaScore;
    return cuerpo.score;
  }
}
