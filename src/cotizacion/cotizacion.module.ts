import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TercerosClient } from '../clients/terceros.client';
import { CotizacionController } from './cotizacion.controller';
import { CotizacionService } from './cotizacion.service';
import { Cotizacion } from './entities/cotizacion.entity';

/**
 * Dominio de Cotizacion: ofertas economicas de productos de seguro.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Cotizacion])],
  controllers: [CotizacionController],
  providers: [CotizacionService, TercerosClient],
  exports: [CotizacionService],
})
export class CotizacionModule {}
