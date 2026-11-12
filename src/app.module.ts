import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CotizacionModule } from './cotizacion/cotizacion.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'cotizacion'),
        password: config.get<string>('DB_PASSWORD', 'cotizacion'),
        database: config.get<string>('DB_NAME', 'cotizacion'),
        autoLoadEntities: true,
        // true por defecto (local, como antes). En AWS: DB_SYNCHRONIZE=false y
        // el esquema lo crea database/init.sql contra la RDS.
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        logging: config.get<string>('DB_LOGGING') === 'true',
        // RDS PostgreSQL 16 exige SSL por defecto (rds.force_ssl=1).
        ssl:
          config.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
        // Tactica de dimensionamiento del pool: conexiones POR REPLICA.
        // replicas maximas de asg-cotizacion x DB_POOL_MAX <= max_connections
        // de la RDS (db.t3.micro ~ 80).
        extra: { max: Number(config.get<string>('DB_POOL_MAX', '10')) },
      }),
    }),
    CotizacionModule,
    HealthModule,
  ],
})
export class AppModule {}
