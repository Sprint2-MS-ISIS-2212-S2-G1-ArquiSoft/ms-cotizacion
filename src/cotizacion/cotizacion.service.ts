import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { TercerosClient } from '../clients/terceros.client';
import { CrearCotizacionDto } from './dtos/crear-cotizacion.dto';
import { Cotizacion } from './entities/cotizacion.entity';
import { EstadoCotizacion } from './enums/estado-cotizacion.enum';

@Injectable()
export class CotizacionService {
  constructor(
    @InjectRepository(Cotizacion)
    private readonly cotizacionRepository: Repository<Cotizacion>,
    private readonly tercerosClient: TercerosClient,
  ) {}

  /**
   * Crea la cotizacion. Es la operacion que Distribucion invocaba en proceso
   * como cotizacionService.crearCotizacion(producto, cliente, socio, score).
   *
   * El calculo es el del monolito, sin cambios, incluidas dos rarezas que se
   * conservan a proposito: la suma asegurada resultante puede superar en
   * hasta 30% la sumaAseguradaMaxima del producto (no hay tope), y el score
   * no se acota a 0-100.
   */
  async crearCotizacion(
    dto: CrearCotizacionDto,
    socioId: string,
  ): Promise<Cotizacion> {
    // El score solo se consulta si el cliente dio su consentimiento; si no,
    // queda en 0 y la prima es la maxima, igual que en el monolito.
    let openDataScore = 0;
    if (dto.aceptaOpenData) {
      openDataScore = await this.tercerosClient.obtenerScore(
        dto.documento,
        socioId,
      );
    }

    // Basic logic for pricing based on OpenData score (0-100)
    // max 30% discount/adjustment
    const basePrima = 100000;
    const baseSuma = parseFloat(dto.sumaAseguradaMaxima || '5000000');

    // adjustment between 0 and 0.3
    const adjustmentFactor = (openDataScore / 100) * 0.3;

    const primaMensual = basePrima - basePrima * adjustmentFactor;
    const sumaAsegurada = baseSuma + baseSuma * adjustmentFactor;

    // 15 days validity
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

    return this.cotizacionRepository.save(cotizacion);
  }

  async getCotizacion(idCotizacion: string): Promise<Cotizacion> {
    // La columna id es uuid: consultar con un id mal formado revienta en
    // Postgres, asi que un id invalido se trata como inexistente (404).
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
    return cotizacion;
  }

  async listarCotizaciones(clienteId?: string): Promise<Cotizacion[]> {
    return this.cotizacionRepository.find({
      where: clienteId ? { clienteId } : {},
      order: { fechaEmision: 'DESC' },
    });
  }

  /**
   * Comprueba que la cotizacion se pueda suscribir. Es la operacion que
   * Distribucion invocaba como cotizacionService.validarCotizacion() al
   * inicio de POST /distribucion/suscribir.
   *
   * Mantiene el comportamiento del monolito, rarezas incluidas: el mismo
   * mensaje de error para "no existe" y para "no vigente" (no filtra
   * existencia), y la expiracion perezosa, el unico cambio de estado que
   * valida una transicion: solo se marca EXPIRADA si venia PENDIENTE. No hay
   * ningun job que expire cotizaciones vencidas, igual que en el monolito.
   */
  async validarCotizacion(idCotizacion: string): Promise<Cotizacion> {
    // Un id mal formado no puede existir: se trata como invalido, no como
    // error de Postgres.
    if (!isUUID(idCotizacion)) {
      throw new BadRequestException('Cotización inválida o expirada');
    }

    const cotizacion = await this.cotizacionRepository.findOne({
      where: { id: idCotizacion },
    });

    if (!cotizacion) {
      throw new BadRequestException('Cotización inválida o expirada');
    }

    if (!cotizacion.estaVigente()) {
      // If expired but not marked as expired, we could update it
      if (cotizacion.estado === EstadoCotizacion.PENDIENTE) {
        cotizacion.estado = EstadoCotizacion.EXPIRADA;
        await this.cotizacionRepository.save(cotizacion);
      }
      throw new BadRequestException('Cotización inválida o expirada');
    }

    return cotizacion;
  }

  /**
   * Cambia el estado de la cotizacion. Reemplaza las dos llamadas de
   * Distribucion a actualizarEstado(): ACEPTADA en el camino feliz y
   * RECHAZADA como compensacion.
   *
   * Igual que el monolito, no valida la transicion: cualquier estado del
   * enum es aceptable desde cualquier otro, porque la compensacion necesita
   * poder pasar de ACEPTADA a RECHAZADA. La unica diferencia es que el
   * monolito hacia un update ciego (un id inexistente era un no-op
   * silencioso) y aqui se responde 404.
   */
  async actualizarEstado(
    idCotizacion: string,
    estado: EstadoCotizacion,
  ): Promise<Cotizacion> {
    const cotizacion = await this.getCotizacion(idCotizacion);
    cotizacion.estado = estado;
    return this.cotizacionRepository.save(cotizacion);
  }
}
