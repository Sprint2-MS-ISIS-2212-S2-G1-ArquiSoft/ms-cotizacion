import { Controller, Get } from '@nestjs/common';
import { OpenDataScoreService } from './open-data-score.service';


@Controller('resiliencia')
export class ResilienciaController {
  constructor(private readonly openDataScore: OpenDataScoreService) {}

  @Get()
  estado() {
    return this.openDataScore.estado();
  }
}