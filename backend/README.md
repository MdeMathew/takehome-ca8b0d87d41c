# Sincronizador de reservas: Java

> **Esta base es opcional.** Puedes cambiar el lenguaje, el framework y todo lo que hay aquí, salvo `mock/` y `check/` (que están en la carpeta de arriba y son tu banco de pruebas). Lo que evaluamos es la funcionalidad y cómo está construida. **Trabaja con IA, y mejor con un agente de código**: en `../AGENTS.md` tiene todo lo que necesita para empezar. Tienes 48 horas como máximo, pero si la das por buena antes, entrégala antes.

```bash
cp .env.example .env
mvn exec:java@start        # tu API y la pantalla, en http://localhost:3000
```

Si no tienes Maven instalado, cambia `mvn` por `./mvnw` (o `mvnw.cmd` en Windows): el wrapper
viene incluido y se lo descarga solo.

En otra terminal, el simulador local de los canales y del PMS. Necesita Node 22.6 o más, pero no hace falta instalar nada (es para el simulador, no para tu servicio; mira `../mock/README.md` para las variables que puedes tocar):

```bash
cd ../mock
node --experimental-strip-types src/application/local-main.ts   # http://localhost:4000
```

Y para comprobar tu entrega antes de subirla, con tu servicio **parado** (el `check` arranca el simulador y tu servicio él solo):

```bash
node ../check/check.mjs    # arranca en rojo, son 12 comprobaciones (Node 22.6 o más)
mvn test                   # tu arnés de partida
```

Java 21. Jackson y JUnit ya están en el `pom.xml`; si prefieres Spring Boot o Javalin al
`com.sun.net.httpserver` de aquí, adelante: va con la estándar para que arranque sin instalar
nada, no porque tenga que ser así.

## Qué hay aquí

| | |
|---|---|
| `domain/NormalizedBooking`, `BookingRecord` | Los tipos |
| `domain/Dates` | Unix a `YYYY-MM-DD` en UTC. Viene resuelta |
| `domain/ChannelPayloads` | **La función que tienes que escribir**: `normalize` |
| `Server` | Tu API. El enrutado está hecho; **`startChannelConsumer` y otros tres manejadores están a 501** |
| `PmsClient` | La llamada al PMS. Escrita, y escrita para un solo intento: sin reintento, sin backoff |
| `ChannelClient` | Las dos llamadas al canal: pedir eventos y confirmar uno. Escritas para un solo intento, sin bucle |
| `Store` | Dónde vive el estado de cada reserva mientras el proceso está arriba. Escrito y completo |
| `http/Json` | El sobre de error, para que todos tus errores salgan iguales |
| `../frontend/index.html` | **Tu mitad de delante**. El `fetch` y el enrutado por `?booking=` están hechos; `renderList` y `renderDetail`, **vacías** |
| `../check/check.mjs` | El comprobador, el mismo para los cuatro lenguajes. Arranca en rojo, y no lee tu código: solo lo que el simulador vio |

## Cómo empezar

Tu servicio **no expone ningún webhook**: nadie le llama. Pregunta a los canales qué reservas tienen (`GET /channels/events`), confirma cada una que recibe (`POST /channels/events/{id}/ack`) y las envía al PMS. Cada evento que te entregan abre un plazo de 500 ms para confirmarlo.

El `check` no depende de cómo diseñes tu API (esa parte es tuya, y se valora que la documentes bien): arranca el simulador y tu servicio, espera a que termine la sesión y mira lo que el simulador vio, nunca lo que tú devuelves. Verifica el contrato de tu API que describe `../AGENTS.md`: `GET /health`, `GET /`, `GET /api/bookings`, `GET /api/bookings/{id}` y `POST /api/bookings/{id}/retry`.

Para probar contra nuestro servicio de verdad, cambia `API_BASE` y `API_TOKEN` en tu `.env`: no hace falta tocar código.

Lee `PmsClient` y `ChannelClient` **antes** de tocarlos. Están hechos, pero no completos, y lo que les falta no lleva un `TODO` encima.
