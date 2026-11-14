import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import {
  OpenDataScoreService,
  OrigenScore,
} from '../resiliencia/open-data-score.service';
import { CrearCotizacionDto } from './dtos/crear-cotizacion.dto';
import { Cotizacion } from './entities/cotizacion.entity';
import { EstadoCotizacion } from './enums/estado-cotizacion.enum';

/**
 * ASR de seguridad (Martin) · aislamiento por socio.
 *
 * Mensaje unico de rechazo por pertenencia. Es un literal fijo a proposito: no
 * menciona el id, ni el socio dueno, ni ningun campo de la cotizacion ajena.
 * El socio que recibe el 403 no debe poder deducir nada del recurso que
 * intento tocar (ni siquiera si existe o de quien es).
 */
const NO_AUTORIZADO = 'No autorizado para este recurso';

@Injectable()
export class CotizacionService {
  private readonly logger = new Logger(CotizacionService.name);

  constructor(
    @InjectRepository(Cotizacion)
    private readonly cotizacionRepository: Repository<Cotizacion>,
        private readonly openDataScore: OpenDataScoreService,
  ) {}


  async crearCotizacion(
    dto: CrearCotizacionDto,
    socioId: string,
    ): Promise<Cotizacion & { origenScore: OrigenScore | null }> {
    let openDataScore = 0;
    let origenScore: OrigenScore | null = null;
    if (dto.aceptaOpenData) {
      const resultado = await this.openDataScore.obtenerScore(
        dto.documento,
        socioId,
      );
      openDataScore = resultado.score;
      origenScore = resultado.origen;
    }


    const basePrima = 100000;
    const baseSuma = parseFloat(dto.sumaAseguradaMaxima || '5000000');


    const adjustmentFactor = (openDataScore / 100) * 0.3;

    const primaMensual = basePrima - basePrima * adjustmentFactor;
    const sumaAsegurada = baseSuma + baseSuma * adjustmentFactor;


    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 15);

    const cotizacion = this.cotizacionRepository.create({
      estado: EstadoCotizacion.PENDIENTE,
      primaMensual: primaMensual.toFixed(2),
      sumaAsegurada: sumaAsegurada.toFixed(2),
      fechaVencimiento,
      productoId: dto.productoId,
      clienteId: dto.clienteId,
      socioDistribucionId: socioId,
    });

    const guardada = await this.cotizacionRepository.save(cotizacion);
    return Object.assign(guardada, { origenScore });
  }

  /**
   * ASR de seguridad (Martin): la cotizacion es del socio que la pidio o no se
   * entrega. Este es el unico sitio que decide la pertenencia, y lo hace el
   * servicio DUENO del dato, no el borde: por eso saltarse el gateway y
   * Distribucion y pegarle directo a Cotizacion desde dentro de la red tampoco
   * sirve para leer la cotizacion de otro socio (defensa en profundidad).
   */
  private verificarPertenencia(cotizacion: Cotizacion, socioId: string): void {
    if (cotizacion.socioDistribucionId !== socioId) {
      this.logger.warn(
        `Socio ${socioId} intento acceder a la cotizacion ${cotizacion.id}, que no es suya`,
      );
      throw new ForbiddenException(NO_AUTORIZADO);
    }
  }

  async getCotizacion(
    idCotizacion: string,
    socioId: string,
  ): Promise<Cotizacion> {

    if (!isUUID(idCotizacion)) {
      throw new NotFoundException(
        `Cotizacion con id ${idCotizacion} no encontrada`,
      );
    }
    const cotizacion = await this.cotizacionRepository.findOne({
      where: { id: idCotizacion },
    });
    if (!cotizacion) {
      throw new NotFoundException(
        `Cotizacion con id ${idCotizacion} no encontrada`,
      );
    }
    this.verificarPertenencia(cotizacion, socioId);
    return cotizacion;
  }

  /**
   * ASR de seguridad (Martin): filtra siempre por el socio del header. El
   * clienteId sigue siendo un filtro opcional ADEMAS de ese, no en su lugar.
   */
  async listarCotizaciones(
    socioId: string,
    clienteId?: string,
  ): Promise<Cotizacion[]> {
    return this.cotizacionRepository.find({
      where: {
        socioDistribucionId: socioId,
        ...(clienteId ? { clienteId } : {}),
      },
      order: { fechaEmision: 'DESC' },
    });
  }


  async validarCotizacion(
    idCotizacion: string,
    socioId: string,
  ): Promise<Cotizacion> {

    if (!isUUID(idCotizacion)) {
      throw new BadRequestException('Cotización inválida o expirada');
    }

    const cotizacion = await this.cotizacionRepository.findOne({
      where: { id: idCotizacion },
    });

    if (!cotizacion) {
      throw new BadRequestException('Cotización inválida o expirada');
    }

    // ASR de seguridad (Martin): la pertenencia se comprueba ANTES del
    // chequeo de vigencia, que tiene efecto de escritura (PENDIENTE ->
    // EXPIRADA). Un socio ajeno no debe poder provocar ese cambio de estado en
    // la cotizacion de otro. Es tambien lo que convierte el "suscribir una
    // cotizacion ajena" de Distribucion en un 403.
    this.verificarPertenencia(cotizacion, socioId);

    if (!cotizacion.estaVigente()) {

      if (cotizacion.estado === EstadoCotizacion.PENDIENTE) {
        cotizacion.estado = EstadoCotizacion.EXPIRADA;
        await this.cotizacionRepository.save(cotizacion);
      }
      throw new BadRequestException('Cotización inválida o expirada');
    }

    return cotizacion;
  }


  async actualizarEstado(
    idCotizacion: string,
    estado: EstadoCotizacion,
    socioId: string,
  ): Promise<Cotizacion> {
    // getCotizacion ya valida la pertenencia: nadie cambia el estado de una
    // cotizacion que no es suya.
    const cotizacion = await this.getCotizacion(idCotizacion, socioId);
    cotizacion.estado = estado;
    return this.cotizacionRepository.save(cotizacion);
  }
}
