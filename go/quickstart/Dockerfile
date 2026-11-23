FROM golang:1.25 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/quickstart ./quickstart

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /out/quickstart /quickstart
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/quickstart"]
