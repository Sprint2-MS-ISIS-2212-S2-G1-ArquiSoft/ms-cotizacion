import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Cuerpo de POST /cotizaciones.
 *
 * En el monolito, crearCotizacion recibia las entidades ProductoSeguro,
 * Cliente y SocioDistribucion ya cargadas. Aqui Distribucion manda solo los
 * datos que el calculo necesita: segun la regla 2 de CLAUDE.md los DTOs se
 * copian, nunca se importan, y Cotizacion no consulta a catalogo ni a
 * identidad.
 *
 * Del producto el calculo del monolito usa unicamente sumaAseguradaMaxima y
 * del cliente ningun campo, por eso no hay mas campos de producto ni de
 * cliente en este DTO. El socio no viaja en el body: llega en X-Socio-Id.
 */
export class CrearCotizacionDto {
  @IsUUID()
  productoId!: string;

  /**
   * Suma asegurada maxima del producto, tal como la devuelve catalogo: un
   * numeric(14,2) de Postgres viaja como string para no perder precision.
   */
  @IsNumberString()
  sumaAseguradaMaxima!: string;

  @IsUUID()
  clienteId!: string;

  /**
   * Documento del cliente. Solo se usa para consultar el score de Open Data
   * en terceros; no se persiste, igual que en el monolito.
   */
  @IsString()
  @IsNotEmpty()
  documento!: string;

  /** Consentimiento del cliente para consultar Open Data. */
  @IsBoolean()
  aceptaOpenData!: boolean;
}
