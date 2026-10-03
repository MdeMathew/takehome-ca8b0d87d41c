# Prueba técnica de Workfactory: sincronizador de reservas

## Contexto y objetivo

Este proyecto es una prueba técnica para optar a un puesto de trabajo en Workfactory. La entrega debe demostrar criterio técnico, dominio de la concurrencia, capacidad de diseñar software mantenible y atención a la experiencia de uso.

La estimación comunicada al candidato es de unas cuatro horas de trabajo efectivo, ampliables con descansos. El material proporcionado establece un máximo de 48 horas desde el inicio y valora la calidad en relación con el tiempo invertido. Registrar el esfuerzo real y no confundir ambas referencias.

Se busca una solución especialmente cuidada y una arquitectura más elaborada cuando aporte valor demostrable. Toda complejidad añadida debe poder explicarse, probarse y mantenerse. Primero cumplir el contrato y resolver los casos difíciles; después completar las mejoras que hagan destacar la entrega.

Estas instrucciones se aplican a todo el espacio de trabajo. La raíz de la aplicación suministrada y de la entrega es `java/`.

## Material recibido y estructura actual

```text
Workfactory/
├── AGENTS.md                  # Criterios y requisitos de trabajo
├── base-java.zip              # Material original de la empresa
└── java/
    ├── AGENTS.md              # Referencia a estas instrucciones
    ├── README.md              # Explicación de la solución final
    ├── backend/
    │   ├── pom.xml            # Java 21, Maven, Jackson y JUnit 5
    │   ├── mvnw / mvnw.cmd    # Maven Wrapper
    │   ├── .env.example       # Configuración de ejemplo
    │   ├── Dockerfile         # Dockerfile inicial; falta uno en java/
    │   ├── src/main/java/es/workfactory/bookingsync/
    │   │   ├── Server.java    # HTTP, rutas y arranque del consumidor
    │   │   ├── ChannelClient.java
    │   │   ├── PmsClient.java
    │   │   ├── Store.java     # Estado en memoria en el esqueleto
    │   │   ├── Env.java
    │   │   ├── domain/        # Reservas, fechas y normalización
    │   │   └── http/Json.java # Serialización y respuestas de error
    │   └── src/test/java/     # Pruebas propias
    ├── frontend/index.html    # Pantalla de control de partida
    ├── mock/                  # Simulador proporcionado; protegido
    └── check/                 # Comprobador proporcionado; protegido
```

Este mapa describe el punto de partida, no una arquitectura terminada. El consumidor, los tres manejadores de reservas, la normalización y las funciones de renderizado están pendientes. Los clientes HTTP hacen un solo intento y no resuelven reintentos, límites de peticiones ni fallos de comunicación. El almacenamiento es volátil; sus operaciones actuales no garantizan la exclusión de procesos concurrentes sobre la misma reserva.

La base Java es opcional: se permite cambiar lenguaje, framework, backend y frontend, justificando la decisión. No presentar una tecnología como elegida ni una mejora como implementada antes de realizarla y verificarla.

## Problema y requisitos funcionales

Construir un servicio que consulte eventos de Booking y Airbnb, normalice sus reservas y las sincronice con un PMS lento y poco fiable, con una pantalla para consultar el resultado y reintentar fallos.

- El servicio consulta los canales mediante polling; no recibe webhooks.
- Booking entrega fechas `YYYY-MM-DD` y `guest_name`.
- Airbnb entrega fechas Unix en segundos UTC y `guest.first_name` / `guest.last_name`.
- El PMS recibe `{ bookingId, channel, guestName, checkIn, checkOut, totalPrice, currency }`, con fechas `YYYY-MM-DD`.
- Cada evento debe confirmarse en menos de 500 ms desde su entrega, sin esperar al PMS. El PMS tarda entre tres y cinco segundos.
- Pueden recibirse varios eventos para el mismo `booking_id`, incluso casi simultáneamente. La misma reserva no debe crearse dos veces en el PMS.
- Reintentar fallos recuperables con espera entre intentos y un límite definido; al agotarlo, marcar la reserva como `failed`.
- Mostrar reservas y estados, permitir consultar el detalle y forzar la sincronización de reservas fallidas.
- Incluir un `Dockerfile` en `java/`, la raíz de la aplicación, y comandos reproducibles de construcción y arranque.

### Contrato HTTP de la aplicación

| Ruta | Resultado requerido |
| --- | --- |
| `GET /health` | `200` cuando el servicio esté preparado |
| `GET /` | `200` con la pantalla HTML |
| `GET /api/bookings` | `200` con `{ "items": [...] }`, ordenado por actualización descendente |
| `GET /api/bookings/{id}` | `200` con la reserva o `404` si no existe |
| `POST /api/bookings/{id}/retry` | `202` para una reserva `failed`, `409` para otro estado y `404` si no existe |

Cada reserva expone `id` (el `booking_id` original), `channel`, `guestName`, `checkIn`, `checkOut`, `totalPrice`, `currency`, `status`, `attempts`, `lastError`, `pmsReference` y `updatedAt`. `lastError` y `pmsReference` admiten `null`. Los estados públicos son `pending`, `syncing`, `synced`, `retrying` y `failed`.

### Integración externa

Configurar por entorno: `PORT=3000`, `API_BASE=http://localhost:4000` y `API_TOKEN=wf_local` por defecto. Las llamadas externas usan `Authorization: Bearer {API_TOKEN}`.

| Ruta externa | Propósito |
| --- | --- |
| `GET /channels/events?limit=1` | Obtener eventos disponibles |
| `POST /channels/events/{eventId}/ack` | Confirmar recepción; una confirmación tardía devuelve `409` |
| `POST /pms/reservations` | Enviar una reserva normalizada |
| `GET /pms/reservations` | Consultar reservas registradas |

Consultar la documentación del simulador en `GET {API_BASE}/` con el token y en `{API_BASE}/swagger` antes de asumir formatos o semánticas de errores. Esperar entre consultas; el enunciado sugiere unos 400 ms. Respetar `Retry-After` cuando corresponda.

## Principios de diseño obligatorios

Aplicar SOLID obligatoriamente y de forma verificable:

- **Responsabilidad única:** separar reglas de negocio, normalización, sincronización, almacenamiento, transporte HTTP y presentación.
- **Abierto/cerrado:** facilitar nuevos canales y políticas sin dispersar condicionales por el sistema.
- **Sustitución de Liskov:** mantener contratos coherentes entre implementaciones reales y sustitutos de prueba.
- **Segregación de interfaces:** contratos pequeños orientados a las necesidades de cada consumidor.
- **Inversión de dependencias:** dominio y casos de uso dependen de abstracciones; conectar adaptadores concretos en el punto de composición.

Usar prácticas profesionales: nombres claros, encapsulación, composición, inyección de dependencias, configuración validada, errores explícitos, recursos cerrados y dependencias justificadas. Mantener el dominio independiente del framework cuando resulte viable. Evitar estado global mutable y dependencias estáticas que dificulten las pruebas.

Utilizar el máximo número de patrones de diseño que tengan una aplicación real y justificada. Cada patrón debe resolver un problema concreto y aportar claridad, extensibilidad, seguridad o capacidad de prueba. Considerar:

- **Arquitectura hexagonal y Adapter:** aislar canales, PMS, persistencia y API del dominio.
- **Strategy:** normalización por canal y políticas de reintento sustituibles.
- **Repository:** abstraer almacenamiento y operaciones atómicas sobre reservas.
- **Casos de uso y servicios de aplicación:** coordinar ingestión, consultas y reintentos manuales.
- **Producer–Consumer:** desacoplar confirmaciones rápidas de envíos lentos al PMS.
- **Máquina de estados:** proteger transiciones válidas; usar clases State solo si mejoran el modelo.
- **Factory o registro de estrategias:** seleccionar adaptadores sin acoplar el flujo principal a sus detalles.
- **Decorator:** métricas, registros o resiliencia transversales cuando evite duplicación real.
- **Transactional Outbox:** evaluar si se incorpora persistencia duradera y se necesita coordinar el estado guardado con el trabajo pendiente.

La lista es orientativa, no una obligación de implementar todos sus elementos. Documentar los patrones usados y su utilidad. No añadir capas vacías, jerarquías innecesarias ni infraestructura sin un caso de uso comprobable. Combinar SOLID con DRY, KISS y YAGNI.

## Fiabilidad, concurrencia y seguridad

- Separar confirmación y procesamiento lento. Ninguna espera del PMS ni espera de reintento debe bloquear la recepción y confirmación.
- Definir qué ocurre si el proceso se detiene entre recepción, confirmación, almacenamiento y envío. Si la garantía se limita al proceso en ejecución, explicarlo y probarla; no afirmar durabilidad inexistente.
- Distinguir identidad de evento e identidad de reserva. Deduplicar y excluir trabajo concurrente por la identidad de reserva requerida por el contrato.
- Hacer atómicos el registro, la adquisición de trabajo y el reintento manual. Una colección concurrente o campos `volatile` no vuelven atómica una secuencia de operaciones.
- Definir estados, transiciones, contador de intentos y limpieza de errores tras un éxito. No reabrir reservas sincronizadas por eventos duplicados.
- Diferenciar rechazo recuperable, error definitivo y resultado incierto tras un timeout. Comprobar las garantías del PMS; no prometer entrega exactamente una vez si no puede demostrarse.
- Acotar concurrencia, cola, tiempos de espera e intentos. Evitar bucles agresivos y esperas bloqueantes en manejadores HTTP.
- Usar backoff configurable y valorar jitter. Respetar los límites de peticiones de todas las llamadas externas.
- Preferir tipos explícitos para estados, fechas y dinero; evitar errores de precisión monetaria y conversiones de zona horaria.
- Validar entradas y escapar datos en la pantalla. No guardar tokens reales, secretos ni datos personales innecesarios en repositorio, errores o logs.
- Facilitar diagnóstico con identificadores y estados, sin exponer credenciales. Implementar apagado ordenado cuando corresponda.

## Método de trabajo y validación

1. Leer enunciado, clientes existentes, configuración y comprobador antes de modificar el comportamiento.
2. Identificar contratos, invariantes, riesgos y decisiones pendientes.
3. Obtener una referencia inicial de los fallos del comprobador y avanzar escenario a escenario.
4. Completar una solución funcional; después incorporar mejoras justificadas de arquitectura y presentación.
5. Probar normalización y UTC, deduplicación concurrente, transiciones, agotamiento de reintentos, reintento manual, límites de peticiones y fallos de comunicación relevantes.
6. Usar reloj, política de espera y clientes sustituibles para pruebas deterministas cuando proceda; evitar pruebas que solo reproduzcan la implementación.
7. Ejecutar pruebas propias, comprobador oficial y validación de arranque y Docker. Revisar la pantalla, estados vacíos, carga y errores.
8. Actualizar el README con comandos verificados, decisiones reales, limitaciones y resultados.

Comandos de referencia de la base, pendientes de adaptar y verificar al cerrar la solución:

```sh
# Simulador: desde java/mock/
node --experimental-strip-types src/application/local-main.ts

# Servicio y pruebas propias: desde java/backend/
cp .env.example .env
./mvnw compile exec:java@start
./mvnw test

# Comprobador: desde java/, con servicio y simulador manuales parados
node check/check.mjs
node check/check.mjs --only 1
```

La base requiere Java 21 y Node 22.6 o superior para el simulador y el comprobador. El comprobador arranca ambos procesos y contiene tres escenarios. No declarar verificaciones correctas sin ejecutarlas ni confundir pruebas propias con el comprobador oficial.

## Archivos protegidos y alcance

- Conservar `base-java.zip` como referencia original.
- No modificar `java/mock/` ni la lógica, escenarios o aserciones de `java/check/`.
- La única configuración autorizada dentro de `check/` es ajustar `config.json` para indicar cómo arrancar el servicio, tal como permite el enunciado. Preferir opciones CLI si bastan.
- Se permite reestructurar código propio, actualizar dependencias y sustituir la base, conservando el contrato público.
- Los archivos `._*` son metadatos de macOS; no incluirlos en la entrega.
- Actualizar estas instrucciones y el mapa del proyecto si cambia la estructura.

## Redacción y presentación

Código, comentarios, interfaz, mensajes de commit y documentación deben mantener una voz técnica natural y consistente con la del candidato. No añadir firmas, marcas de herramientas, atribuciones automáticas, frases de generación, conversaciones, prompts ni referencias al proceso de asistencia dentro del producto. Los comentarios explican intención, restricciones y decisiones; no narran cómo se escribió el código.

La excepción explícita es la sección del README exigida por la empresa sobre el uso de IA o del agente. Explicar el uso real con transparencia, sin inventar trabajo manual, estrategias, resultados ni decisiones. Esa sección no autoriza a distribuir marcas o atribuciones por la entrega. Los documentos originales del ZIP son material de la empresa.

## Contenido obligatorio de java/README.md

El README es la explicación principal de la entrega. Redactarlo desde la perspectiva del candidato, con hechos comprobables y razones concretas. Debe cubrir:

1. **Cómo arrancarlo en local:** requisitos, configuración, comandos exactos del simulador y la aplicación, puertos, pruebas, comprobador y Docker; incluir persistencia si se añade.
2. **Por qué elegí esa tecnología:** relación entre stack, experiencia, restricciones y necesidades; justificar cambios respecto a la base.
3. **Cómo usé la IA o el agente y con qué estrategia:** qué pedí, cómo dividí el trabajo, qué revisé y validé, qué acepté, qué descarté y por qué.
4. **Qué encontré por el camino y cómo lo resolví:** problemas observados y soluciones verificadas, especialmente concurrencia, confirmaciones, duplicados y fallos del PMS.
5. **Qué decidí y por qué:** arquitectura, patrones realmente usados, persistencia, identidad, estados, reintentos y sus compromisos.
6. **Qué dejé fuera a propósito:** alcance descartado y motivo; distinguir decisiones deliberadas de funcionalidad pendiente.
7. **Qué me costó más:** dificultades reales, cómo se abordaron y aprendizaje, sin inventar experiencias.

Incluir un mapa actualizado, una captura de la pantalla funcionando como pide el README de partida y las limitaciones materiales. Evitar documentación genérica, promesas no verificadas y relatos ajenos al trabajo realizado.
