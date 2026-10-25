# Deployment

- Web: Vercel project `qafila`, root `apps/web`, domain qafila.dev (DNS on Cloudflare).
- API: AWS EC2 `qafila-api` (eu-west-1, Elastic IP in `.shared/ec2.json`), Ubuntu 24.04, Node 22, pnpm 10, poppler-utils, Caddy (TLS for api.qafila.dev, reverse proxy to :8787). Repo at `/opt/qafila/repo`, env at `/opt/qafila/.env` (copied by hand, never committed). Service: `deploy/qafila-api.service` (API + worker in one process, `WORKER=1`). Deploy with `deploy/deploy-api.sh`.
- Secrets never leave `.env` files; the server's `.env` is `scp`'d from the laptop.
