import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TercerosClient } from '../clients/terceros.client';
import { OpenDataScoreService } from '../resiliencia/open-data-score.service';
import { ResilienciaController } from '../resiliencia/resiliencia.controller';
import { ScoreCacheService } from '../resiliencia/score-cache.service';
import { CotizacionController } from './cotizacion.controller';
import { CotizacionService } from './cotizacion.service';
import { Cotizacion } from './entities/cotizacion.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Cotizacion])],
  controllers: [CotizacionController, ResilienciaController],
  providers: [
    CotizacionService,
    TercerosClient,
    ScoreCacheService,
    OpenDataScoreService,
  ],
  exports: [CotizacionService],
})
export class CotizacionModule {}