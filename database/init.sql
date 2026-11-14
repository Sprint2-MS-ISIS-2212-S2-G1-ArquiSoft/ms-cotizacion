--
-- BD Cotizacion · esquema y datos semilla del microservicio cotizacion.
-- Extraido de database/solventa.sql del monolito modular.
-- Las llaves foraneas de cotizaciones hacia productos_seguro, clientes,
-- socios_distribucion y suscripciones NO se replican: esas tablas viven en
-- otros microservicios (catalogo, identidad, distribucion y suscripciones) y
-- aqui quedan como columnas de id, segun la regla 3 de CLAUDE.md.
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

--
-- Name: cotizaciones_estado_enum; Type: TYPE
--
DO $$
BEGIN
    CREATE TYPE public.cotizaciones_estado_enum AS ENUM (
        'PENDIENTE',
        'ACEPTADA',
        'RECHAZADA',
        'EXPIRADA'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

--
-- Name: cotizaciones; Type: TABLE
--
-- La columna "clienteId" no aparece en el dump del monolito porque la creaba
-- synchronize: true a partir de la relacion @ManyToOne('Cliente') de la
-- entidad; aqui se declara explicitamente.
--
CREATE TABLE IF NOT EXISTS public.cotizaciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.cotizaciones_estado_enum NOT NULL,
    "primaMensual" numeric(14,2) NOT NULL,
    "sumaAsegurada" numeric(14,2) NOT NULL,
    "fechaEmision" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaVencimiento" timestamp without time zone NOT NULL,
    "socioDistribucionId" uuid,
    "productoId" uuid,
    "suscripcionId" uuid,
    "clienteId" uuid,
    CONSTRAINT "PK_4fcc685d6bca9b3a997ba9cd3bc" PRIMARY KEY (id)
);

--
-- Datos semilla
--
-- El monolito no trae ninguna cotizacion (el COPY public.cotizaciones de
-- database/solventa.sql esta vacio y seed.sql no la toca), asi que estas dos
-- filas son DATOS LOCALES inventados para poder probar las lecturas sin
-- crear una cotizacion antes. Referencian los uuid semilla de los otros
-- microservicios:
--   producto 123e4567-e89b-12d3-a456-426614174000 (Seguro de Vida Base,
--     sumaAseguradaMaxima 5000000.00) de ms-catalogo
--   cliente  123e4567-e89b-12d3-a456-426614174010 (Ana Gomez) de ms-identidad
--   socio    123e4567-e89b-12d3-a456-426614174001 (Banco Aliado)
-- "suscripcionId" queda NULL: en el monolito lo escribia el modulo de
-- suscripcion mutando la entidad compartida, y ese escritor desaparecio al
-- separar los servicios.
--

-- Vigente (score 50: prima 100000 - 15%, suma 5000000 + 15%).
INSERT INTO public.cotizaciones (
    id, estado, "primaMensual", "sumaAsegurada", "fechaVencimiento",
    "socioDistribucionId", "productoId", "suscripcionId", "clienteId"
)
VALUES (
    '123e4567-e89b-12d3-a456-426614174020',
    'PENDIENTE',
    85000.00,
    5750000.00,
    now() + interval '15 days',
    '123e4567-e89b-12d3-a456-426614174001',
    '123e4567-e89b-12d3-a456-426614174000',
    NULL,
    '123e4567-e89b-12d3-a456-426614174010'
)
ON CONFLICT DO NOTHING;

-- Ya aceptada (score 0: sin ajuste por Open Data).
INSERT INTO public.cotizaciones (
    id, estado, "primaMensual", "sumaAsegurada", "fechaVencimiento",
    "socioDistribucionId", "productoId", "suscripcionId", "clienteId"
)
VALUES (
    '123e4567-e89b-12d3-a456-426614174021',
    'ACEPTADA',
    100000.00,
    5000000.00,
    now() + interval '15 days',
    '123e4567-e89b-12d3-a456-426614174001',
    '123e4567-e89b-12d3-a456-426614174000',
    NULL,
    '123e4567-e89b-12d3-a456-426614174010'
)
ON CONFLICT DO NOTHING;


--
-- ASR de seguridad (Martin) · datos para probar el aislamiento entre socios
--
-- Socios (viven en Redis, en ms-distribucion/src/socios/socios.seed.json):
--   A 123e4567-e89b-12d3-a456-426614174001  Banco Aliado         alcance completo
--   B 123e4567-e89b-12d3-a456-426614174002  Aseguratec Partners  sin siniestros:leer
--   C 123e4567-e89b-12d3-a456-426614174003  Comparador Vitrina   solo cotizaciones:leer
--

-- Cotizacion del socio B. Es el recurso ajeno del caso de prueba: el socio A
-- pide ESTE id y tiene que recibir 403 sin datos, aunque la cotizacion exista
-- y aunque A si tenga el scope cotizaciones:leer.
INSERT INTO public.cotizaciones (
    id, estado, "primaMensual", "sumaAsegurada", "fechaVencimiento",
    "socioDistribucionId", "productoId", "suscripcionId", "clienteId"
)
VALUES (
    '123e4567-e89b-12d3-a456-426614174022',
    'PENDIENTE',
    85000.00,
    5750000.00,
    now() + interval '15 days',
    '123e4567-e89b-12d3-a456-426614174002',
    '123e4567-e89b-12d3-a456-426614174000',
    NULL,
    '123e4567-e89b-12d3-a456-426614174010'
)
ON CONFLICT DO NOTHING;

--
-- 100 cotizaciones por socio (A, B y C) = 300 filas.
--
-- Sirven para la medida del ASR (p95 < 500 ms a 75 TPS): con volumen real por
-- socio, el filtrado por socioDistribucionId se mide de verdad en vez de sobre
-- una tabla de dos filas.
--
-- Los ids son DETERMINISTAS para poder apuntarles desde JMeter o curl sin
-- consultar antes la base: <letra del socio>0000000-0000-4000-8000-<n en 12
-- digitos>, con n de 1 a 100.
--
--   socio A -> a0000000-0000-4000-8000-000000000001 .. 000000000100
--   socio B -> b0000000-0000-4000-8000-000000000001 .. 000000000100
--   socio C -> c0000000-0000-4000-8000-000000000001 .. 000000000100
--
-- Mismo producto y mismo cliente semilla que las filas de arriba.
--
INSERT INTO public.cotizaciones (
    id, estado, "primaMensual", "sumaAsegurada", "fechaVencimiento",
    "socioDistribucionId", "productoId", "suscripcionId", "clienteId"
)
SELECT
    (s.prefijo || lpad(n::text, 12, '0'))::uuid,
    'PENDIENTE',
    85000.00,
    5750000.00,
    now() + interval '15 days',
    s.socio::uuid,
    '123e4567-e89b-12d3-a456-426614174000',
    NULL,
    '123e4567-e89b-12d3-a456-426614174010'
FROM (VALUES
    ('a0000000-0000-4000-8000-', '123e4567-e89b-12d3-a456-426614174001'),
    ('b0000000-0000-4000-8000-', '123e4567-e89b-12d3-a456-426614174002'),
    ('c0000000-0000-4000-8000-', '123e4567-e89b-12d3-a456-426614174003')
) AS s(prefijo, socio),
generate_series(1, 100) AS n
ON CONFLICT DO NOTHING;

-- El filtro por socio es el camino caliente de toda lectura de cotizaciones.
CREATE INDEX IF NOT EXISTS idx_cotizaciones_socio
    ON public.cotizaciones ("socioDistribucionId");
