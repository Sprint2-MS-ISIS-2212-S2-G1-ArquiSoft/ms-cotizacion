import { IsEnum } from 'class-validator';
import { EstadoCotizacion } from '../enums/estado-cotizacion.enum';

/**
 * Cuerpo de PATCH /cotizaciones/:id/estado.
 *
 * Reemplaza las dos llamadas en proceso que Distribucion hacia a
 * cotizacionService.actualizarEstado(): ACEPTADA cuando la suscripcion y la
 * emision salen bien, RECHAZADA como compensacion cuando algo falla.
 */
export class ActualizarEstadoDto {
  @IsEnum(EstadoCotizacion)
  estado!: EstadoCotizacion;
}
