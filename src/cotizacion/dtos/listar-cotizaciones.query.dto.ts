import { IsOptional, IsUUID } from 'class-validator';

export class ListarCotizacionesQueryDto {
  /** Filtra el listado por cliente (coincidencia exacta). */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
