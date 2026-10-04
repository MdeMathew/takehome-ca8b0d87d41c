# Integración con el PMS

Este paquete convierte una reserva ya normalizada en un registro del PMS y coordina su envío sin bloquear la recepción de eventos de los canales. Separa el transporte HTTP de la gestión del trabajo pendiente: el cliente realiza un único intento; el registrador decide cuándo enviarlo, si debe repetirlo y cómo reflejar el resultado en la reserva.

```text
pms/
├── client/
│   ├── PmsClient.java             Contrato de envío y resultado
│   └── WorkfactoryPmsClient.java  Adaptador HTTP del PMS
└── registerer/
    └── PmsRegisterer.java        Cola, estados y reintentos
```

## Clases y responsabilidades

| Clase | Función |
| --- | --- |
| [`PmsClient`](client/PmsClient.java) | Define `submit(NormalizedBooking)`: un intento de registrar una reserva. Su `Result` reúne el indicador de éxito, la referencia devuelta por el PMS y el código HTTP. Al depender de esta interfaz, el registrador puede utilizar otro adaptador o un sustituto en pruebas. |
| [`WorkfactoryPmsClient`](client/WorkfactoryPmsClient.java) | Implementa el envío mediante `POST /pms/reservations`. Construye el JSON con `bookingId`, `channel`, `guestName`, `checkIn`, `checkOut`, `totalPrice` y `currency`, y añade el token Bearer. Una respuesta con código inferior a 300 se interpreta como éxito y se lee `reservationId` como referencia; los códigos desde 300 se devuelven como fallo. Los errores de transporte o de lectura se propagan al registrador. No incorpora una política propia de reintentos. |
| [`PmsRegisterer`](registerer/PmsRegisterer.java) | Administra una cola en memoria con un trabajador que envía las reservas de una en una. Excluye trabajos simultáneos para un mismo ID, limita los trabajos admitidos, programa los reintentos y actualiza el estado de cada `BookingRecord`. Un supervisor repone el trabajador si termina inesperadamente. |

## Recorrido de una reserva

1. `Server` entrega al registrador un conjunto de reservas `pending` mediante `enqueueNewBookings`. La admisión en cola no espera la respuesta del PMS.
2. El registrador descarta las reservas `synced` y las que ya están en cola o en curso con el mismo ID. Reserva una plaza antes de programar el envío; si no queda capacidad, marca la reserva como `failed`.
3. El trabajador toma la siguiente reserva disponible, la marca como `syncing` y llama a `PmsClient.submit` con su representación `NormalizedBooking`.
4. Si el PMS confirma el registro, guarda `pmsReference`, incrementa `attempts` y marca la reserva como `synced`. Si el intento falla, deja el error y el contador en `retrying`, o en `failed` al agotar el límite.
5. Un reintento automático se programa para 400 ms después. Durante esa espera, el trabajador puede atender otra reserva. El ID y la plaza siguen reservados hasta que la secuencia termina.

La cola admite hasta 1024 trabajos entre pendientes y activos. Hay un solo trabajador de envío. El límite de intentos se lee de `MAX_TRIES_FOR_REGISTERING_BOOKING_PMS` y, si no se configura, es **4**. El registrador no distingue entre códigos HTTP recuperables y definitivos: cualquier respuesta fallida puede volver a intentarse hasta ese límite.

## Métodos clave

| Método | Comportamiento |
| --- | --- |
| `WorkfactoryPmsClient.submit(NormalizedBooking)` | Serializa la reserva, hace una única petición HTTP y transforma la respuesta en `PmsClient.Result`. |
| `PmsRegisterer.start()` | Arranca el trabajador y su supervisor. También se invoca automáticamente al admitir el primer trabajo si aún no se había iniciado. |
| `PmsRegisterer.enqueueNewBookings(Set<BookingRecord>)` | Añade reservas nuevas sin hacer la llamada HTTP en el hilo que las recibe. Evita el trabajo concurrente para el mismo ID y señala los rechazos por parada o cola llena en el estado de la reserva. |
| `PmsRegisterer.retryFailedBooking(BookingRecord)` | Admite un reintento manual solo si la reserva está en `failed` y hay capacidad. Restablece `attempts` a cero y el estado a `pending`. Devuelve `ACCEPTED`, `NOT_FAILED` o `UNAVAILABLE`, que `Server` traduce a la respuesta de la API. |
| `PmsRegisterer.attemptBooking(BookingRecord)` | Ejecuta un intento, actualiza contador y estado, y decide entre éxito, nuevo intento o fallo final. Las excepciones del cliente se registran como errores del intento. |
| `PmsRegisterer.stop()` | Interrumpe los hilos, espera su terminación durante un tiempo acotado y marca como fallidas las reservas aún en cola. También marca la reserva activa si el trabajador ya se ha detenido sin completarla. |

`WorkfactoryPmsClient` toma `API_BASE` (por defecto `http://localhost:4000`) y `API_TOKEN` (por defecto `wf_local`) de la configuración de la aplicación. Establece 10 segundos para conectar y 15 segundos para cada petición. El registrador utiliza el mismo objeto `BookingRecord` que consulta la API, por lo que los cambios de estado quedan visibles sin copiar el registro.

## Alcance de las garantías

La exclusión por ID y la cola actúan **dentro del proceso en ejecución**. Ni el trabajo pendiente ni el estado se conservan al reiniciar la aplicación. Además, si una petición agota su tiempo de espera después de que el PMS la haya aceptado, el resultado es incierto: el reintento automático puede crear otra reserva en el PMS. La implementación no ofrece una garantía de registro exactamente una vez ante ese caso; necesitaría conciliación con el PMS o una clave de idempotencia admitida por él.
