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

@Controller()
export class CotizacionController {
  constructor(private readonly cotizacionService: CotizacionService) {}

  /**
   * El socio no viaja en el body: lo inyecta el gateway como X-Socio-Id y
   * Distribucion lo propaga. Es obligatorio y debe ser uuid, para que ninguna
   * cotizacion quede sin socioDistribucionId.
   */
  @Post('cotizaciones')
  crearCotizacion(
    @Body() dto: CrearCotizacionDto,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<Cotizacion> {
    if (!socioId || !isUUID(socioId)) {
      throw new BadRequestException('Header X-Socio-Id requerido');
    }
    return this.cotizacionService.crearCotizacion(dto, socioId);
  }

  @Get('cotizaciones')
  listarCotizaciones(
    @Query() query: ListarCotizacionesQueryDto,
  ): Promise<Cotizacion[]> {
    return this.cotizacionService.listarCotizaciones(query.clienteId);
  }

  /** Sin ParseUUIDPipe a proposito: el 404 lo decide el servicio. */
  @Get('cotizaciones/:id')
  getCotizacion(@Param('id') id: string): Promise<Cotizacion> {
    return this.cotizacionService.getCotizacion(id);
  }

  @Patch('cotizaciones/:id/estado')
  actualizarEstado(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoDto,
  ): Promise<Cotizacion> {
    return this.cotizacionService.actualizarEstado(id, dto.estado);
  }

  /**
   * 200 y no 201: no crea nada, comprueba que la cotizacion se pueda
   * suscribir (y la marca EXPIRADA si vencio).
   */
  @Post('cotizaciones/:id/validacion')
  @HttpCode(200)
  validarCotizacion(@Param('id') id: string): Promise<Cotizacion> {
    return this.cotizacionService.validarCotizacion(id);
  }
}
