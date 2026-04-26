# weather-llm Agent Guide

## Purpose

- `weather-llm` is the React and Vite browser client for the weather assistant.
- It is the user-facing app served from `nws` on port `5173`.

## Connection Rules

- The browser must use an explicit LAN API URL. The deployed value should match `http://192.168.6.87:3000`.
- Do not assume browser traffic can resolve container-only hostnames.

## Deployment Target

- Deploy client changes to `nws` at `pi@192.168.6.87`.
- The steady-state deploy path is GitHub-first from `/home/pi/development/weather-stack/weather-llm-iac` via `sh ./scripts/deploy_nws_from_git.sh client`; treat raw `sudo docker-compose ...` as break-glass fallback only.

## Deploy Flow

- Push `weather-llm` changes to GitHub before deploying.
- Keep `/home/pi/development/weather-stack/weather-llm` as a Git checkout on `main`.
- Do not copy client source files into the Pi checkout; deploy by fast-forwarding the live Git checkout from GitHub.
- Deploy from `/home/pi/development/weather-stack/weather-llm-iac` with `sh ./scripts/deploy_nws_from_git.sh client` so the live Pi checkout is fast-forwarded from GitHub before `client` is recreated.
- In prebuilt-image mode (`PREFER_PREBUILT_IMAGES=true`), this deploy step only pulls and recreates. It does not rebuild `weather-llm-client:latest`.

## Image Rebuild (when fresh image is required)

When the running container must be rebuilt from source, use the registry publish workflow:

1. Push changes to GitHub.
2. SSH to `nws` and rebuild the image with `sudo`:
   ```bash
   ssh -o IdentitiesOnly=yes -i ~/.ssh/id_weather_stack_pi pi@192.168.6.87 '
   set -e
   export GITHUB_SSH_KEY_PATH=$HOME/.ssh/id_github
   export GIT_SSH_COMMAND="ssh -i $GITHUB_SSH_KEY_PATH -o IdentitiesOnly=yes"
   git -C /home/pi/development/weather-stack/weather-llm pull --ff-only origin main
   sudo sh /home/pi/development/weather-stack/weather-llm-iac/scripts/publish_images_to_registry.sh
   '
   ```
   `publish_images_to_registry.sh` **must be run with `sudo`** on `nws` (Docker socket permission requirement).
3. Deploy via the wrapper:
   ```bash
   ssh -o IdentitiesOnly=yes -i ~/.ssh/id_weather_stack_pi pi@192.168.6.87 \
     'export GITHUB_SSH_KEY_PATH=$HOME/.ssh/id_github; cd /home/pi/development/weather-stack/weather-llm-iac && sh ./scripts/deploy_nws_from_git.sh client'
   ```
4. Verify: `curl -I http://192.168.6.87:5173`

### Stale Image Guardrails

- If UI behavior does not match your pushed commit, assume the local-registry `:latest` tag is stale.
- Republish first, then deploy:
  1.  `sudo sh /home/pi/development/weather-stack/weather-llm-iac/scripts/publish_images_to_registry.sh`
  2.  `sh /home/pi/development/weather-stack/weather-llm-iac/scripts/deploy_nws_from_git.sh client`
- Validate runtime behavior after deploy, not only container status. If needed, hard refresh the browser once to bypass cached assets.

## Validation

- Check the deployed UI with `curl -I http://192.168.6.87:5173`.
- If a change touches Ask LLM or conversation bootstrap behavior, also verify `http://192.168.6.87:3000/nws-alerts/conversation/latest`.

## References

- See `../weather-llm-iac/AGENTS.md` for the full deployment map.
- See `README.md` and `src/pages/PromptPage.tsx` for current client behavior.
