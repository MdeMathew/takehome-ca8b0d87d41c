# El build context es la RAÍZ del starter, no `backend/`: el front es un módulo aparte y este
# servidor lo lee de disco, así que la imagen necesita los dos.
#
#   docker build -f backend/Dockerfile .
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY backend/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY backend/src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app/backend
COPY --from=build /src/target/booking-sync.jar ./app.jar
COPY frontend /app/frontend
USER nobody
CMD ["java", "-jar", "app.jar"]
