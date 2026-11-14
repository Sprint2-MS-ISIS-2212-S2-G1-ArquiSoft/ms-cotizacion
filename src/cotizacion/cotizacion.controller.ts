import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { CotizacionService } from './cotizacion.service';
import { ActualizarEstadoDto } from './dtos/actualizar-estado.dto';
import { CrearCotizacionDto } from './dtos/crear-cotizacion.dto';
import { ListarCotizacionesQueryDto } from './dtos/listar-cotizaciones.query.dto';
import { Cotizacion } from './entities/cotizacion.entity';
import { OrigenScore } from '../resiliencia/open-data-score.service';

/**
 * ASR de seguridad (Martin) · aislamiento por socio.
 *
 * X-Socio-Id es obligatorio en TODAS las rutas de cotizaciones, no solo en la
 * creacion: el socio del header es lo que permite decidir si la cotizacion que
 * se esta leyendo o modificando le pertenece. Sin header no hay forma de
 * decidirlo, asi que se rechaza con 400 en vez de atender a ciegas.
 *
 * Quien pone el header es el gateway Nginx a partir del certificado mTLS
 * (ssl_client_s_dn -> X-Socio-Id), y Distribucion lo propaga; el socio no
 * puede elegirlo.
 */
@Controller()
export class CotizacionController {
  constructor(private readonly cotizacionService: CotizacionService) {}

  /**
   * Exige el socio del header. Un solo sitio para el mismo 400 de las cinco
   * rutas, con el mismo mensaje que ya devolvia la creacion.
   */
  private exigirSocio(socioId?: string): string {
    if (!socioId || !isUUID(socioId)) {
      throw new BadRequestException('Header X-Socio-Id requerido');
    }
    return socioId;
  }

  /**
   * El socio no viaja en el body: lo inyecta el gateway como X-Socio-Id y
   * Distribucion lo propaga. Es obligatorio y debe ser uuid, para que ninguna
   * cotizacion quede sin socioDistribucionId.
   */
  @Post('cotizaciones')
  crearCotizacion(
    @Body() dto: CrearCotizacionDto,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion & { origenScore: OrigenScore | null }> {
    return this.cotizacionService.crearCotizacion(dto, this.exigirSocio(socioId));
  }

  /**
   * ASR de seguridad: el listado filtra SIEMPRE por el socio del header,
   * ademas del clienteId opcional. Antes devolvia las cotizaciones de todos
   * los socios a cualquiera que preguntara.
   */
  @Get('cotizaciones')
  listarCotizaciones(
    @Query() query: ListarCotizacionesQueryDto,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion[]> {
    return this.cotizacionService.listarCotizaciones(
      this.exigirSocio(socioId),
      query.clienteId,
    );
  }

  /** Sin ParseUUIDPipe a proposito: el 404 lo decide el servicio. */
  @Get('cotizaciones/:id')
  getCotizacion(
    @Param('id') id: string,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion> {
    return this.cotizacionService.getCotizacion(id, this.exigirSocio(socioId));
  }

  @Patch('cotizaciones/:id/estado')
  actualizarEstado(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoDto,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion> {
    return this.cotizacionService.actualizarEstado(
      id,
      dto.estado,
      this.exigirSocio(socioId),
    );
  }

  /**
   * 200 y no 201: no crea nada, comprueba que la cotizacion se pueda
   * suscribir (y la marca EXPIRADA si vencio).
   */
  @Post('cotizaciones/:id/validacion')
  @HttpCode(200)
  validarCotizacion(
    @Param('id') id: string,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion> {
    return this.cotizacionService.validarCotizacion(
      id,
      this.exigirSocio(socioId),
    );
  }
}
