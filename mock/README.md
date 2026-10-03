# El simulador local

Es el mismo servicio que nosotros ejecutamos, con las mismas reglas, pero en tu máquina y sin nada
que instalar. Simula tres cosas: los canales de venta (`booking` y `airbnb`), el PMS al que tienes
que reenviar las reservas, y el reloj que las va soltando.

```bash
node --experimental-strip-types src/application/local-main.ts     # http://localhost:4000
```

Hace falta Node 22.6 o más. Tu servicio lo encuentra con `API_BASE` (por defecto
`http://localhost:4000`) y se presenta con `API_TOKEN` (por defecto `wf_local`; en local vale
cualquier cosa que empiece por `wf_`).

## Qué te da

| | |
|---|---|
| `GET /channels/events` | Los eventos que ya te tocan. Cada uno que te entrega abre un plazo para confirmarlo |
| `POST /channels/events/{id}/ack` | Confirmas que lo recibiste. Tarde, vuelve a llegarte |
| `POST /pms/reservations` | El PMS. Lento, a veces no responde, y no avisa de lo que ya tiene |
| `GET /pms/reservations` | Lo que el PMS tiene guardado de ti |

Qué formato tiene cada cosa y qué responde en cada caso lo tienes que descubrir, igual que en el
servicio de verdad. No hay documentación aparte: la respuesta de cada llamada te dice por dónde seguir.

## Lo que puedes tocar

Se configura con variables de entorno, para que puedas provocarte a ti misma los casos difíciles:

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4000` | |
| `CHANNEL_INTERVAL_MS` | `4000` | Cada cuánto te llega una reserva nueva |
| `CHANNEL_EVENT_COUNT` | `40` | Eventos que tiene una sesión |
| `CHANNEL_ECHO_PROBABILITY` | `0.25` | Cuántas reservas se repiten |
| `PMS_DELAY_MIN_MS` / `PMS_DELAY_MAX_MS` | `3000` / `5000` | Lo que tarda el PMS |
| `PMS_ERROR_RATE` | `0.3` | Fracción de envíos que el PMS rechaza |
| `PMS_FAIL_FIRST_N` | `0` | Los primeros N envíos fallan seguro |

Cambiarlas aquí no cambia nada en el servicio de verdad: allí no puedes tocar nada, y lo que hagas
queda registrado.

⚠️ Esta carpeta se genera. No la edites: se regenera desde `services/mock-api` con `tools/sync-mock.sh`.
