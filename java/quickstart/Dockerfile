# Build context must be java/ (the quickstart depends on the sibling
# starter module through the Maven reactor, see ../pom.xml):
#   docker build -f quickstart/Dockerfile -t obs-instrumentation-java-quickstart .
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /workspace
COPY pom.xml ./
COPY obs-instrumentation-spring-boot-starter ./obs-instrumentation-spring-boot-starter
COPY quickstart ./quickstart
RUN mvn -q -pl obs-instrumentation-spring-boot-starter,quickstart -am install -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /workspace/quickstart/target/obs-instrumentation-quickstart-*.jar app.jar
EXPOSE 8080
USER 1000:1000
ENTRYPOINT ["java", "-jar", "app.jar"]
