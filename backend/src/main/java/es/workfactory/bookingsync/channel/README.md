# Integración con los canales de venta

Este paquete concentra la recepción y confirmación de eventos procedentes de los canales de venta. Separa las llamadas HTTP y los datos recibidos de la lógica que decide qué reservas registrar. Su salida es una página de eventos **confirmados**, lista para que `Server` normalice las reservas y las entregue al flujo de sincronización con el PMS.

## Recorrido de un evento

1. `Server` invoca `ChannelEventConsumer.fetchEvents(10)` en su bucle de consulta.
2. El consumidor obtiene una página mediante `ChannelClient.fetchEvents(limit)` y trata de confirmar cada evento por su `eventId`.
3. Devuelve únicamente los eventos cuya confirmación ha recibido una respuesta satisfactoria. `Server` normaliza sus `payload`, descarta reservas ya conocidas y encola las nuevas para el PMS.
4. El bucle espera 400 ms antes de volver a consultar el canal. El envío al PMS ocurre fuera de este paquete y no retrasa las confirmaciones.

La identidad de la reserva, que puede aparecer en varios eventos, se gestiona después de la normalización; confirmar un evento no equivale a registrar su reserva en el PMS.

## Clases y responsabilidades

| Clase | Función |
| --- | --- |
| `ChannelClient` | Adaptador HTTP de la API de canales. Construye las peticiones con `API_BASE` y el token Bearer `API_TOKEN`, consulta los eventos y envía sus confirmaciones. |
| `ChannelEventConsumer` | Coordina la consulta y las confirmaciones dentro de una ventana temporal. Reintenta las confirmaciones pendientes mientras queda tiempo y filtra los eventos no confirmados. |
| `ChannelEvent` | Datos de un evento recibido: `eventId`, canal, número de entrega (`deliveryAttempt`) y `payload` JSON original. |
| `EventsPage` | Resultado de una consulta: lista de eventos y marca `done` recibida del canal. En la salida del consumidor, la lista contiene solo eventos confirmados. |
| `Acknowledgement` | Resultado de una confirmación: `ok` indica si el estado HTTP es inferior a 300 y `status` conserva el código para inspección. |

### `ChannelClient`

`fetchEvents(int limit)` ejecuta `GET /channels/events?limit=…`. Exige una respuesta `200`, lee `events` y `done` del JSON y crea un `ChannelEvent` por cada elemento. Ante otro estado HTTP lanza una excepción; los errores de conexión o de lectura del JSON también se propagan.

`ackEvent(String eventId)` y su variante con `Duration timeout` envían `POST /channels/events/{eventId}/ack`. Ambas devuelven un `Acknowledgement`: una respuesta HTTP desfavorable queda representada en el resultado, mientras que un error de transporte se propaga como excepción. La variante con tiempo de espera permite al consumidor ajustar cada petición al margen que le queda.

El cliente utiliza `API_BASE=http://localhost:4000` y `API_TOKEN=wf_local` como valores predeterminados. Configura 10 segundos para establecer la conexión y 15 segundos por petición, salvo cuando la confirmación recibe un tiempo de espera específico.

### `ChannelEventConsumer`

`fetchEvents(int limit)` fija un plazo de 500 ms antes de iniciar la consulta. Si esta falla, `manageException` registra una descripción breve para errores de JSON, comunicación o respuesta HTTP no válida y propaga la excepción. Ante una interrupción, restaura la marca de interrupción del hilo.

`acknowledgeEvents` recorre los eventos pendientes y llama a `ChannelClient.ackEvent` con un tiempo de espera individual de hasta 100 ms, ajustado al tiempo restante y al número de eventos pendientes. Si una confirmación falla o devuelve un estado no satisfactorio, conserva el evento pendiente para otro intento dentro del mismo plazo. Entre rondas espera 25 ms. Al agotarse el tiempo, devuelve solo los eventos confirmados; si el hilo se interrumpe, devuelve los confirmados hasta ese momento. La marca `done` se conserva tal como llegó del canal, aunque se hayan filtrado eventos de la lista.
