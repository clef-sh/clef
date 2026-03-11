# Deployment

Clef's web presence is deployed via two Cloudflare Pages projects, both sourced from the same monorepo (`clef-sh/clef`).

## Projects

| Project     | Build command              | Output directory       | Domain         |
| ----------- | -------------------------- | ---------------------- | -------------- |
| `clef-site` | `cd www && npm run build`  | `www/dist`             | `clef.sh`      |
| `clef-docs` | `cd docs && npm run build` | `docs/.vitepress/dist` | `docs.clef.sh` |

## Environment variables

Neither project requires environment variables for production builds. All configuration is static and committed to the repository.

## Branch configuration

- **Production branch:** `main`
- **Preview branches:** all other branches

## Preview deployments

Every pull request automatically gets a preview deployment for each project:

- Preview URLs follow the pattern `<commit-hash>.clef-site.pages.dev` and `<commit-hash>.clef-docs.pages.dev`
- Preview deployments are deleted when the PR is closed
- Preview builds use the same build commands as production

## Custom domains (DNS)

| Domain         | Record type | Value                 |
| -------------- | ----------- | --------------------- |
| `clef.sh`      | CNAME       | `clef-site.pages.dev` |
| `docs.clef.sh` | CNAME       | `clef-docs.pages.dev` |

Both CNAME records are managed in the Cloudflare DNS dashboard for the `clef.sh` zone.

## Setting up a new project

To recreate or verify either project in the Cloudflare Pages dashboard:

1. Go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Select the `clef-sh/clef` repository
3. Set the **build command** and **build output directory** from the table above
4. Leave environment variables empty
5. Deploy and configure the custom domain under **Custom domains**

## Troubleshooting

**Build fails:** Check that `npm install` runs in the project root first. Cloudflare Pages runs it automatically, but if the lockfile is out of date the install may fail. Push a fresh `npm install && git add package-lock.json` commit.

**Wrong output directory:** The output path is relative to the repository root, not the build command directory. For example, `docs/.vitepress/dist` — not `.vitepress/dist`.

**Stale dependencies:** Cloudflare Pages caches `node_modules` between builds. If dependencies change unexpectedly, clear the cache in the project's **Settings** → **Builds & deployments** → **Build cache** → **Clear cache**.

**Preview not deploying:** Ensure the branch has changes in the relevant project directory (`www/` or `docs/`). Cloudflare Pages may skip builds if no files changed in the configured root directory.
