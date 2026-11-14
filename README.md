# Solventa · microservicio `cotizacion`

ISIS-2212 Arquitecturas de software robustas · Grupo 1 · Sprint 2

**Responsabilidad:** Cotización de pólizas. Escala horizontalmente con la demanda y responde con el último score de Open Data en caché cuando el proveedor falla.

| | |
|---|---|
| Nodo de despliegue | ASG Cotización ×2 (AZ a / AZ b), junto a catalogo, detrás del ALB interno |
| Llama a | terceros (HTTP) |
| Lo llaman | distribucion (vía ALB) |
| Base de datos | BD Cotización (RDS PostgreSQL, Multi-AZ) |
| Puerto interno | 3000 |
| Origen en el monolito | `src/modules/cotizacion` |

## Correr en local

```bash
cp .env.example .env
npm ci
npm run start:dev
```

El despliegue (docker-compose por nodo EC2), el gateway, los certificados y la documentación de experimentos viven en el repositorio paraguas `Sprint2-MS-ISIS-2212-S2-G1-ArquiSoft/ISIS2212_202620_S2_Grupo1`, rama `sprint-2-microservicios`.

## Correr en local con Docker

```bash
docker compose -f docker-compose.local.yml up -d --build
curl localhost:3005/health
docker compose -f docker-compose.local.yml down
```

`docker-compose.local.yml` es **solo para desarrollo**: levanta este servicio
(host `3005` → contenedor `3000`), su propio `postgres:16-alpine` (host `5435`
→ contenedor `5432`), que carga `database/init.sql` al crearse, y un
`terceros-mock` (host `3007`) que implementa el contrato
`POST /open-data/scores` de `ms-terceros` devolviendo siempre `{"score": 50}`,
para que las primas calculadas sean deterministas. Detener ese contenedor
(`docker compose -f docker-compose.local.yml stop terceros-mock`) es la forma
de probar el `503` de Open Data.

## API

Contrato que consume Distribución. Todas las respuestas son
`application/json`.

El header `X-Socio-Id` lo inyecta el gateway (que termina mTLS) y Distribución
lo propaga. En `POST /cotizaciones` es **obligatorio y debe ser uuid**: es el
socio que queda guardado en `socioDistribucionId`, así que ninguna cotización
puede crearse sin él. El socio **no** viaja en el body.

Cotización no consulta a Catálogo ni a Identidad: los datos de producto y de
cliente que el cálculo necesita llegan en el body desde Distribución. Su única
dependencia saliente es `terceros` (Open Data), vía `TERCEROS_URL`.

### `GET /health`

Verifica el servicio y la conexión a la BD (`SELECT 1`).

| | |
|---|---|
| Body | — |
| `200` | `{ "status": "ok" }` |
| `503` | `{ "status": "error", "database": "unreachable" }` |

### `POST /cotizaciones`

Crea la cotización. Reemplaza la llamada en proceso
`cotizacionService.crearCotizacion(producto, cliente, socio, openDataScore)`
que `DistribucionService.cotizar` hacía en el monolito (incluida la consulta
del score a Terceros, que antes era `tercerosService.getOpenDataScore`).

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. **Obligatorio.** |
| Body | `{ "productoId": uuid, "sumaAseguradaMaxima": string numérico, "clienteId": uuid, "documento": string, "aceptaOpenData": boolean }` |
| `201` | la cotización creada |
| `400` | body inválido, o `X-Socio-Id` ausente o no uuid: `{ "message": "Header X-Socio-Id requerido", ... }` |
| `503` | `{ "message": "Servicio Open Data no disponible", "error": "Service Unavailable", "statusCode": 503 }` — solo puede ocurrir con `aceptaOpenData: true` |

```bash
curl -X POST localhost:3005/cotizaciones \
  -H 'Content-Type: application/json' \
  -H 'X-Socio-Id: 123e4567-e89b-12d3-a456-426614174001' \
  -d '{
    "productoId": "123e4567-e89b-12d3-a456-426614174000",
    "sumaAseguradaMaxima": "5000000.00",
    "clienteId": "123e4567-e89b-12d3-a456-426614174010",
    "documento": "1020304050",
    "aceptaOpenData": true
  }'
```

```json
{
  "id": "9a80c612-1599-4bbd-ace5-b367ac2630d2",
  "estado": "PENDIENTE",
  "primaMensual": "85000.00",
  "sumaAsegurada": "5750000.00",
  "fechaEmision": "2026-11-12T00:19:41.571Z",
  "fechaVencimiento": "2026-11-27T00:19:41.563Z",
  "socioDistribucionId": "123e4567-e89b-12d3-a456-426614174001",
  "productoId": "123e4567-e89b-12d3-a456-426614174000",
  "suscripcionId": null,
  "clienteId": "123e4567-e89b-12d3-a456-426614174010"
}
```

**Cálculo** (copiado literal del monolito, `cotizacion.service.ts`):

```
openDataScore   = aceptaOpenData ? POST {TERCEROS_URL}/open-data/scores : 0
adjustmentFactor = (openDataScore / 100) * 0.3          // 0 .. 0,3
primaMensual     = 100000 - 100000 * adjustmentFactor
sumaAsegurada    = sumaAseguradaMaxima * (1 + adjustmentFactor)
fechaVencimiento = hoy + 15 días
estado           = PENDIENTE
```

Con el mock (score 50): prima `85000.00`, suma `5750000.00`. Con
`aceptaOpenData: false` (score 0): prima `100000.00`, suma igual a la máxima
del producto. La prima base `100000` está fija en el código del monolito y no
depende del producto ni del ramo.

Notas del contrato:

- `sumaAseguradaMaxima` llega como **string numérico** porque es lo que
  devuelve `GET /productos/:id` de Catálogo (un `numeric(14,2)` de Postgres
  viaja como string para no perder precisión). `primaMensual` y
  `sumaAsegurada` se devuelven igual, como string.
- Del producto el cálculo usa **solo** `sumaAseguradaMaxima`, y del cliente
  **ningún** campo: por eso el body no pide más datos de producto ni de
  cliente.
- `documento` se usa únicamente para consultar Open Data; **no se persiste**,
  igual que en el monolito.
- Dos rarezas del monolito se conservan a propósito: la `sumaAsegurada`
  resultante puede **superar en hasta 30 % la `sumaAseguradaMaxima`** del
  producto (no hay tope), y el score no se acota a 0-100.
- `suscripcionId` siempre sale `null`: ver la nota al final.

### `GET /cotizaciones`

Lista las cotizaciones, más reciente primero (`fechaEmision DESC`).

| | |
|---|---|
| Query | `clienteId` (opcional): uuid del cliente |
| Body | — |
| `200` | arreglo de cotizaciones (vacío si el filtro no encuentra nada) |
| `400` | `clienteId` no es un uuid |

```bash
curl "localhost:3005/cotizaciones?clienteId=123e4567-e89b-12d3-a456-426614174010"
```

El monolito no tenía ningún endpoint de lectura de cotizaciones; este y el
siguiente existen porque al separar el servicio Distribución ya no puede
consultar la tabla directamente.

### `GET /cotizaciones/:id`

Una cotización por id.

| | |
|---|---|
| Param | `id`: uuid de la cotización |
| Body | — |
| `200` | la cotización |
| `404` | `{ "message": "Cotizacion con id <id> no encontrada", "error": "Not Found", "statusCode": 404 }` |

Un `id` que no sea uuid también devuelve `404`, no `400`: para quien consume,
cualquier id que no exista se comporta igual.

```bash
curl localhost:3005/cotizaciones/123e4567-e89b-12d3-a456-426614174020
```

### `PATCH /cotizaciones/:id/estado`

Cambia el estado. Reemplaza las dos llamadas que `DistribucionService` hacía a
`cotizacionService.actualizarEstado()`: `ACEPTADA` cuando la suscripción, el
pago y la emisión salen bien, y `RECHAZADA` como compensación cuando algo
falla (esa segunda es la que Distribución necesita para su rollback).

| | |
|---|---|
| Param | `id`: uuid de la cotización |
| Body | `{ "estado": "PENDIENTE" \| "ACEPTADA" \| "RECHAZADA" \| "EXPIRADA" }` |
| `200` | la cotización actualizada |
| `400` | `estado` no es uno de los valores del enum |
| `404` | la cotización no existe (o el id no es uuid) |

```bash
curl -X PATCH localhost:3005/cotizaciones/123e4567-e89b-12d3-a456-426614174020/estado \
  -H 'Content-Type: application/json' \
  -d '{"estado":"RECHAZADA"}'
```

**No valida transiciones**, igual que el monolito: cualquier estado del enum se
acepta desde cualquier otro, porque la compensación necesita poder pasar de
`ACEPTADA` a `RECHAZADA`. La única diferencia con el monolito es que allí un id
inexistente era un `UPDATE` sin efecto y silencioso; aquí responde `404`.

### `POST /cotizaciones/:id/validacion`

Comprueba que la cotización se pueda suscribir. Reemplaza
`cotizacionService.validarCotizacion(id)`, que `DistribucionService` llamaba al
inicio de `POST /distribucion/suscribir`.

| | |
|---|---|
| Param | `id`: uuid de la cotización |
| Body | — |
| `200` | la cotización, vigente (`PENDIENTE` y sin vencer) |
| `400` | `{ "message": "Cotización inválida o expirada", "error": "Bad Request", "statusCode": 400 }` |

```bash
curl -X POST localhost:3005/cotizaciones/123e4567-e89b-12d3-a456-426614174020/validacion
```

`200` y no `201`: no crea nada. Tiene un **efecto de escritura**, heredado del
monolito: si la cotización venció y seguía en `PENDIENTE`, la marca `EXPIRADA`
antes de responder `400`. Es la única expiración que existe; no hay ningún job
que expire cotizaciones vencidas. El mensaje de error es el mismo si la
cotización no existe, si el id no es uuid, si venció o si ya no está
`PENDIENTE`: tampoco filtra existencia en el monolito.

## Datos semilla

`database/init.sql` crea el esquema y dos cotizaciones **inventadas en este
repositorio**: el monolito no trae ninguna (su `COPY public.cotizaciones` está
vacío y `seed.sql` no la toca). Referencian los uuid semilla de los otros
servicios:

| uuid | estado | prima | suma |
|---|---|---|---|
| `123e4567-e89b-12d3-a456-426614174020` | `PENDIENTE`, vigente 15 días | `85000.00` | `5750000.00` |
| `123e4567-e89b-12d3-a456-426614174021` | `ACEPTADA` | `100000.00` | `5000000.00` |

Ambas con `productoId` `…174000` (*Seguro de Vida Base*, de `ms-catalogo`),
`clienteId` `…174010` (*Ana Gomez*, de `ms-identidad`) y
`socioDistribucionId` `…174001` (*Banco Aliado*).

## Relaciones convertidas en columnas

Las `@ManyToOne` del monolito hacia entidades de otros servicios son ahora
columnas de id (regla 3 de CLAUDE.md), conservando el nombre de columna
original:

| Monolito | Aquí | Servicio dueño del dato |
|---|---|---|
| `@ManyToOne(() => ProductoSeguro)` | `productoId uuid` | catalogo |
| `@ManyToOne('Cliente')` | `clienteId uuid` | identidad |
| `@ManyToOne(() => SocioDistribucion)` | `socioDistribucionId uuid` | distribucion |
| `@ManyToOne(() => Suscripcion)` | `suscripcionId uuid` | suscripciones |
| `@OneToOne(() => Poliza)` | *(eliminada)* | emision |

La relación con `Poliza` se eliminó porque era el lado inverso y no tenía
columna aquí: la llave foránea vive en `polizas."cotizacionId"`, en Emisión.

`suscripcionId` queda **siempre `null`**. En el monolito la escribía el módulo
de suscripción mutando la entidad `Cotizacion` y persistiéndola con el
`EntityManager` transaccional compartido de Distribución
(`suscripcion.service.ts`: `cotizacion.suscripcion = …; manager.save(…)`). Ese
escritor desapareció al separar los servicios, y no se añadió ningún endpoint
para fijarla porque el monolito no tiene ninguno. La columna se conserva para
no apartarse del esquema de origen.

Por lo mismo, la atomicidad que el monolito lograba con una sola conexión
Postgres (suscripción + pago + emisión + estado de la cotización en una
transacción) ya no existe: Distribución la reemplaza con la compensación
`PATCH /cotizaciones/:id/estado` → `RECHAZADA`.

## Tácticas de ASR que no se migraron

El ASR de este servicio (disponibilidad de la cotización ante fallos de Open
Data) se implementa en su propia rama. De este andamio están
**deliberadamente ausentes**:

- caché del último score de Open Data y respuesta degradada cuando el
  proveedor falla (hoy: `503`);
- circuit breaker y reintentos con backoff (el mock del monolito los tenía con
  `opossum`; aquí solo queda el timeout de 5 s, que es obligatorio);
- autoescalado del ASG, mTLS, rate limiting e idempotencia;
- ~~filtrado de cotizaciones por pertenencia del socio~~ → **ya implementado**,
  ver [ASR de seguridad](#asr-de-seguridad).

## ASR de seguridad

> *Aislamiento y autorización por alcance en la API de socios* (Martín).
> Un socio bien autenticado no puede leer ni modificar recursos de otro socio:
> el sistema responde `403` y **no devuelve datos del otro socio**.

Este servicio es el **dueño del dato** y por eso es él quien decide la
pertenencia, no el borde. Esa es la parte de **defensa en profundidad** del ASR:
comprometer el gateway o Distribución no alcanza para leer la cotización de otro
socio, porque la comparación vuelve a hacerse aquí.

```bash
# desde dentro de la red, saltándose gateway Y Distribución:
# la cotización 174022 es del socio B, el header dice socio A -> 403
docker compose exec -T distribucion wget -S -qO- \
  --header 'X-Socio-Id: 123e4567-e89b-12d3-a456-426614174001' \
  http://cotizacion:3000/cotizaciones/123e4567-e89b-12d3-a456-426614174022
```

### Dónde está cada táctica

| Táctica | Dónde |
|---|---|
| Autorización por recurso (pertenencia del socio) | [`src/cotizacion/cotizacion.service.ts:90`](src/cotizacion/cotizacion.service.ts#L90) `verificarPertenencia()` |
| `X-Socio-Id` obligatorio en todas las rutas | [`src/cotizacion/cotizacion.controller.ts:41`](src/cotizacion/cotizacion.controller.ts#L41) `exigirSocio()` |
| Listado filtrado por socio | [`src/cotizacion/cotizacion.service.ts:125`](src/cotizacion/cotizacion.service.ts#L125) `listarCotizaciones()` |
| Sin fuga de datos en el `403` | [`src/cotizacion/cotizacion.service.ts:27`](src/cotizacion/cotizacion.service.ts#L27) literal `NO_AUTORIZADO` |
| Datos semilla por socio (A, B, C) | [`database/init.sql:133`](database/init.sql#L133) |
| mTLS y cifrado en tránsito | `solventa-infra/gateway/nginx.conf` (el socio nunca llega aquí directo) |
| Autorización por alcance (scopes) y audit log | `ms-distribucion` (`validador-socio/`) |

### Cambios de contrato

`X-Socio-Id` pasa a ser **obligatorio en las cinco rutas de cotizaciones**, no
solo en `POST /cotizaciones`. Si falta o no es un uuid →
`400 'Header X-Socio-Id requerido'`. Sin el header no hay forma de decidir la
pertenencia, así que atender la petición sería justamente la fuga que este ASR
cierra.

| Ruta | Antes | Ahora |
|---|---|---|
| `POST /cotizaciones` | `400` si falta el header | igual |
| `GET /cotizaciones?clienteId=` | devolvía las cotizaciones de **todos** los socios | header obligatorio; filtra por socio (+ `clienteId` opcional) |
| `GET /cotizaciones/:id` | header ignorado | header obligatorio; `404` si no existe, `403` si es de otro socio |
| `PATCH /cotizaciones/:id/estado` | header ignorado | header obligatorio; `403` si es de otro socio |
| `POST /cotizaciones/:id/validacion` | header ignorado | header obligatorio; `403` si es de otro socio, **antes** de marcarla `EXPIRADA` |

En `validacion` el orden importa: el chequeo de vigencia tiene efecto de
escritura (`PENDIENTE → EXPIRADA`), así que la pertenencia se verifica primero
para que un socio ajeno no pueda provocar ese cambio de estado. Es también lo
que convierte *"suscribir una cotización ajena"* en un `403`, porque
`POST /suscribir` de Distribución empieza llamando a esta ruta.

### Datos semilla del ASR

Además de las dos cotizaciones del socio A (`…174020`, `…174021`):

| Id | Socio | Estado | Para qué |
|---|---|---|---|
| [`123e4567-…-426614174022`](database/init.sql#L120) | B | `PENDIENTE` | recurso ajeno: el socio A pide este id y recibe `403` |
| `a0000000-0000-4000-8000-000000000001` … `-000000000100` | A | `PENDIENTE` | 100 por socio, ids deterministas, para medir con volumen real |
| `b0000000-0000-4000-8000-000000000001` … `-000000000100` | B | `PENDIENTE` | idem |
| `c0000000-0000-4000-8000-000000000001` … `-000000000100` | C | `PENDIENTE` | idem |

Los 300 se generan con `generate_series` en
[`database/init.sql:133`](database/init.sql#L133), más un índice sobre
`"socioDistribucionId"`, que es el camino caliente de toda lectura.
