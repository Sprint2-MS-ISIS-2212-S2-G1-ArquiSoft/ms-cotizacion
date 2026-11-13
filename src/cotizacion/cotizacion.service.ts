import {
  BadRequestException,
  Injectable,
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

@Injectable()
export class CotizacionService {
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

  async getCotizacion(idCotizacion: string): Promise<Cotizacion> {

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


  async validarCotizacion(idCotizacion: string): Promise<Cotizacion> {

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
  ): Promise<Cotizacion> {
    const cotizacion = await this.getCotizacion(idCotizacion);
    cotizacion.estado = estado;
    return this.cotizacionRepository.save(cotizacion);
  }
}
