import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EstadoCotizacion } from '../enums/estado-cotizacion.enum';

/**
 * Oferta economica presentada al cliente para un producto de seguro.
 *
 * Las relaciones @ManyToOne del monolito hacia ProductoSeguro (catalogo),
 * Cliente (identidad), SocioDistribucion (distribucion) y Suscripcion
 * (suscripciones) se volvieron columnas de id, conservando el nombre de
 * columna original: regla 3 de CLAUDE.md. El @OneToOne hacia Poliza se
 * elimino: era el lado inverso de la relacion y no tenia columna aqui (la
 * llave foranea vive en polizas."cotizacionId", en el servicio de emision).
 */
@Entity('cotizaciones')
export class Cotizacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: EstadoCotizacion })
  estado!: EstadoCotizacion;

  /** Prima mensual ofertada. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  primaMensual!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  sumaAsegurada!: string;

  @CreateDateColumn()
  fechaEmision!: Date;

  @Column({ type: 'timestamp' })
  fechaVencimiento!: Date;

  /** Socio comercial a traves del cual se solicito la cotizacion. */
  @Column({ type: 'uuid', nullable: true })
  socioDistribucionId!: string | null;

  /** Producto del catalogo que se esta cotizando. */
  @Column({ type: 'uuid', nullable: true })
  productoId!: string | null;

  /**
   * Suscripcion que sustenta el riesgo de esta cotizacion.
   *
   * Siempre null en este servicio: en el monolito la escribia el modulo de
   * suscripcion mutando la entidad compartida dentro de la transaccion de
   * Distribucion, y ese escritor desaparecio al separar los servicios. Se
   * conserva la columna para no apartarse del esquema del monolito.
   */
  @Column({ type: 'uuid', nullable: true })
  suscripcionId!: string | null;

  /** Cliente asociado a esta cotizacion. */
  @Column({ type: 'uuid', nullable: true })
  clienteId!: string | null;

  /** Metodo base: la cotizacion sigue vigente si no ha expirado. */
  estaVigente(): boolean {
    return (
      this.estado === EstadoCotizacion.PENDIENTE &&
      this.fechaVencimiento > new Date()
    );
  }
}
