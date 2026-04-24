# weather-llm Agent Guide

## Purpose

- `weather-llm` is the React and Vite browser client for the weather assistant.
- It is the user-facing app served from `nws` on port `5173`.

## Connection Rules

- The browser must use an explicit LAN API URL. The deployed value should match `http://192.168.6.87:3000`.
- Do not assume browser traffic can resolve container-only hostnames.

## Deployment Target

- Deploy client changes to `nws` at `pi@192.168.6.87`.
- Rebuild the `client` service from `/home/pi/development/weather-stack/weather-llm-iac` with `sudo docker-compose up -d --build --no-deps --force-recreate client`.

## Deploy Flow

- Push `weather-llm` changes to GitHub before deploying.
- Keep `/home/pi/development/weather-stack/weather-llm` as a Git checkout on `main`.
- Deploy from `/home/pi/development/weather-stack/weather-llm-iac` with `sh ./scripts/deploy_nws_from_git.sh client` so the live Pi checkout is fast-forwarded from GitHub before `client` is recreated.

## Validation

- Check the deployed UI with `curl -I http://192.168.6.87:5173`.
- If a change touches Ask LLM or conversation bootstrap behavior, also verify `http://192.168.6.87:3000/nws-alerts/conversation/latest`.

## References

- See `../weather-llm-iac/AGENTS.md` for the full deployment map.
- See `README.md` and `src/pages/PromptPage.tsx` for current client behavior.
