# Normalización de reservas por canal

Este paquete convierte los eventos de Booking y Airbnb en un mismo modelo, `NormalizedBooking`. Así, el resto de la aplicación puede tratar una reserva sin conocer cómo representa cada canal al huésped, las fechas o el importe.

```text
payload_normalize/
├── ChannelPayloadNormalizer.java
└── normalizers/
    ├── AirbnbPayloadNormalizer.java
    ├── BookingPayloadNormalizer.java
    └── PayloadFieldsChecker.java
```

## Recorrido de un evento

`Server` entrega el `payload` de cada evento confirmado a `ChannelPayloadNormalizer.normalize(JsonNode)`. Este método lee `channel` y delega en el normalizador correspondiente. Ambos construyen un `NormalizedBooking` con los mismos campos: `id`, `channel`, `guestName`, `checkIn`, `checkOut`, `totalPrice` y `currency`. Después, `Server` transforma ese resultado en un `BookingRecord` para continuar el proceso de sincronización.

Los campos propios de cada canal que no forman parte de ese modelo se ignoran. Si el canal no es `booking` o `airbnb`, o un dato obligatorio falta, está vacío o tiene un formato inválido, la normalización lanza `IllegalArgumentException`; no crea una reserva parcial ni sustituye datos ausentes por valores predeterminados.

## Clases y métodos principales

| Clase | Responsabilidad |
| --- | --- |
| `ChannelPayloadNormalizer` | Es el punto de entrada. Su método estático `normalize` selecciona el normalizador según el valor de `channel` y rechaza los canales desconocidos. |
| `normalizers/BookingPayloadNormalizer` | Interpreta el formato de Booking. `normalize` toma `booking_id` como identificador, `guest_name` como nombre y las fechas `check_in` y `check_out` como fechas ISO (`YYYY-MM-DD`). Añade `total_price` y `currency` al modelo común. |
| `normalizers/AirbnbPayloadNormalizer` | Interpreta el formato de Airbnb. `normalize` compone el nombre con `guest.first_name` y `guest.last_name`, y convierte `check_in` y `check_out` desde segundos Unix a fechas ISO en UTC mediante `Dates.toIsoDate`. Los demás campos comunes proceden de `booking_id`, `total_price` y `currency`. |
| `normalizers/PayloadFieldsChecker` | Centraliza las comprobaciones que comparten ambos normalizadores. Tiene visibilidad de paquete, por lo que sus métodos evitan repetir reglas de lectura y validación sin ampliar la API pública. |

`PayloadFieldsChecker` ofrece cuatro operaciones: `text` exige texto no vacío y elimina espacios al principio y al final; `isoDate` comprueba que el texto sea una fecha válida mediante `LocalDate` y devuelve su representación ISO; `unixSeconds` exige un número entero representable como `long`; y `price` exige un número finito y no negativo, que devuelve como `double`.

La conversión de Airbnb usa UTC de forma explícita para que una misma marca temporal produzca la misma fecha con independencia de la zona horaria del servidor. La validación de este paquete se limita a los campos y formatos descritos: no comprueba, por ejemplo, que la salida sea posterior a la entrada ni que `currency` pertenezca a un catálogo de monedas.
