FROM node:22-alpine AS web-builder
WORKDIR /web
COPY server/web/package*.json ./
RUN npm ci
COPY server/web/ ./
RUN npm run build

FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-builder /web/dist ./server/web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o webhook-orchestrator .

FROM alpine:3.21 AS webhook-orchestrator
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=builder /app/webhook-orchestrator .
ENTRYPOINT ["/app/webhook-orchestrator"]
