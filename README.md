# Sincronizador de reservas

<Aquí va lo que construyas: cómo lo enfocaste, qué encontraste por el camino, y una captura de
la pantalla funcionando.>

## Cómo se arranca

La imagen incluye el servicio Java y la pantalla HTML. Estos comandos permiten usarla con el simulador local.

### Imagen Docker

Desde `java/`, construye la imagen:

```sh
docker build -t booking-sync:local .
```

Para probarla con el simulador local, arranca primero el simulador en otra terminal, también desde `java/`:

```sh
cd mock
node --experimental-strip-types src/application/local-main.ts
```

Después arranca el servicio desde `java/` (en macOS o Windows):

```sh
docker run --rm --name booking-sync -p 3000:3000 \
  -e API_BASE=http://host.docker.internal:4000 \
  -e API_TOKEN=wf_local \
  booking-sync:local
```

Abre `http://localhost:3000/` para ver la pantalla y `http://localhost:3000/health` para comprobar que responde. `-p 3000:3000` publica el puerto de la aplicación; `API_BASE` apunta al simulador que corre en el equipo anfitrión. Dentro del contenedor, `localhost` sería el propio contenedor. Para usar la API real, sustituye `API_BASE` y `API_TOKEN` por los valores recibidos. En Linux, añade `--add-host=host.docker.internal:host-gateway` al comando `docker run` si el simulador corre en el anfitrión.

Si construyes desde un disco externo en macOS y Docker falla con `failed to xattr ._*`, ejecuta `dot_clean -m .` desde `java/` para retirar esos archivos auxiliares de macOS y repite `docker build`.

## Cómo usaste la IA

Usé la IA para:

- Diseñar e implementar `frontend/index.html`, porque es una parte del desarrollo que no disfruto hacer.
- Supervisar y corregir el `Dockerfile`, ya que he escrito pocos Dockerfiles y quería revisar su configuración.
- Redactar los README con una estructura profesional y ordenada.
- Investigar errores y oportunidades de optimización en el código.
- Entender el problema al inicio y definir la estructura de carpetas.
- Desarrollar pruebas para comprobar el comportamiento de la aplicación.
- Pedirle que generara diagramas de clases del proyecto.

## Decisiones y lo que dejaste sin resolver

Partí del esqueleto Java y refactoricé el código para separar las responsabilidades del canal, el dominio, el PMS y el almacenamiento. `ChannelClient` realiza las llamadas HTTP, `ChannelEventConsumer` consulta y confirma eventos, los normalizadores adaptan los formatos de Booking y Airbnb a `NormalizedBooking`, y `PmsRegisterer` coordina los envíos y reintentos. Esta separación reduce la lógica concentrada en `Server` y aplica el principio de responsabilidad única donde más aporta: en los límites entre integración externa, reglas de procesamiento y API.

Para la integración con el PMS definí una interfaz pequeña, `PmsClient`, y encapsulé su implementación HTTP en `WorkfactoryPmsClient`. Este adaptador deja que `PmsRegisterer` dependa del contrato y reciba el cliente por constructor. Es una aplicación concreta de inversión de dependencias e inyección de dependencias: la política de reintentos puede probarse o reutilizarse sin acoplarla a la petición HTTP. Los componentes se crean y conectan en `main`, en un único punto de composición.

Usé el patrón productor-consumidor para separar la recepción de eventos del trabajo lento del PMS y priorizar la confirmación dentro del plazo exigido. Una `DelayQueue` programa los reintentos sin bloquear la recepción de nuevas reservas. Un semáforo acota la capacidad a 1024 trabajos y un conjunto de IDs evita encolar dos veces una reserva que ya está pendiente o en curso. El trabajador tiene supervisión para volver a arrancarlo si termina inesperadamente y una parada ordenada. El reintento manual solo acepta reservas `failed` y reinicia su ciclo de intentos.

Para la normalización apliqué la idea del patrón Strategy: `BookingPayloadNormalizer` y `AirbnbPayloadNormalizer` encapsulan dos formas de convertir un payload al mismo modelo, y `ChannelPayloadNormalizer` selecciona la adecuada según el canal. Así las diferencias de nombres y fechas no se propagan al resto del servicio. La selección actual usa un `switch`, de modo que añadir otro canal también requiere ampliar ese selector. Valido los campos obligatorios y convierto las fechas Unix de Airbnb a UTC. Configuré la conexión externa mediante variables de entorno y acoté las peticiones HTTP con tiempos de espera. La API distingue con códigos HTTP los reintentos aceptados, las reservas inexistentes y los estados que no admiten reintento. Añadí pruebas de normalización, fechas, cola, reintentos y API; también contrasté el comportamiento con el comprobador proporcionado.

## Problemas encontrados y límites actuales

El flujo de consulta y confirmación de eventos funciona en los escenarios cubiertos por las pruebas. Una mejora de resiliencia ante incidencias del canal externo —como cortes de red, respuestas no válidas o estados HTTP distintos de 200— sería mantener activo el consumidor después de un fallo transitorio. Actualmente, `ChannelEventConsumer` propaga la excepción y `Server` detiene el servicio y el trabajador del PMS.

Al revisar los errores de comunicación con el PMS detecté otro caso pendiente: si el envío agota su tiempo de espera o se corta la conexión, el PMS podría haber registrado la reserva aunque mi servicio no recibiera la respuesta. Ahora el trabajador trata esa excepción como un fallo recuperable y vuelve a enviar la reserva, lo que puede crear un duplicado. Para comprobar el resultado tendría que consultar `GET /pms/reservations`, recorrer sus páginas mediante `_links.next` y buscar el `bookingId` antes de decidir qué hacer. No implementé ese módulo de consulta paginada por falta de tiempo. Además, que la reserva no aparezca en una consulta no garantiza que el primer envío no termine más tarde; sin una garantía de idempotencia del PMS no puedo asegurar ausencia absoluta de duplicados ante un resultado incierto.

El trabajo pendiente para el PMS vive en una cola en memoria. Un supervisor comprueba si el hilo trabajador termina inesperadamente y arranca otro para continuar con las reservas que sigan en esa cola. La reserva que estaba en curso queda marcada como fallida con resultado incierto; no la reenvío automáticamente porque el PMS podría haberla aceptado antes de que el hilo terminara. Si se reinicia el proceso, la cola se pierde. Para una solución con recuperación había pensado en guardar una tabla de trabajos pendientes: al arrancar o reiniciar el trabajador, consultaría esa tabla para recuperar los trabajos aún pendientes y trataría por separado los envíos con resultado incierto. No lo implementé por el alcance y la estructura de esta prueba, que parte de un almacenamiento en memoria.
