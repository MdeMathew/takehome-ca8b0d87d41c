# Construir desde java/: docker build -t booking-sync:local .
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY backend/pom.xml ./pom.xml
RUN mvn -q -B dependency:go-offline
COPY backend/src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app/backend
COPY --from=build /build/target/booking-sync.jar ./app.jar
COPY frontend/ /app/frontend/
RUN chmod -R a+rX /app/frontend
ENV PORT=3000
EXPOSE 3000
USER nobody
CMD ["java", "-jar", "app.jar"]
