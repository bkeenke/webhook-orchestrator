.PHONY: build run test docker web

web:
	cd server/web && npm install && npm run build

build: web
	go build -o webhook-orchestrator .

run: build
	./webhook-orchestrator

test:
	go test ./...

docker: web
	docker build -t webhook-orchestrator .
