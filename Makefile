.PHONY: dev

dev:
	trap 'kill 0' INT TERM EXIT; cargo run -p server & pnpm --filter web dev & wait
