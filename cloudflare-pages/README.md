# Cloudflare Pages API Gateway

This replaces the original Worker Custom Domain deployment so `nedapdemo.xyz` can remain authoritative in Namecheap.

## Cloudflare Pages project

Create a Cloudflare Pages project connected to the `mobile-id-managed` GitHub repository.

Recommended build settings:

- Production branch: `main`
- Root directory: `cloudflare-pages`
- Framework preset: None
- Build command: leave blank (or use `exit 0`)
- Build output directory: `public`

The `_worker.js` file uses Pages Functions Advanced Mode and proxies `/api/*` to:

`https://gcaqyryxzcphnovgqxhs.supabase.co/functions/v1/api/*`

Optionally set the Pages environment variable `SUPABASE_FUNCTION_BASE` to:

`https://gcaqyryxzcphnovgqxhs.supabase.co/functions/v1/api`

## Custom subdomain while keeping Namecheap DNS

After the Pages deployment succeeds:

1. In the Cloudflare Pages project, open **Custom domains** and choose **Set up a domain**.
2. Enter `mobileid.nedapdemo.xyz` and continue.
3. Cloudflare will show the Pages hostname, for example `mobile-id-api-gateway.pages.dev`.
4. In Namecheap **Advanced DNS**, create a CNAME record:
   - Type: `CNAME Record`
   - Host: `mobileid`
   - Value: the exact `<project>.pages.dev` hostname shown by Cloudflare
   - TTL: Automatic
5. Do not change the nameservers of `nedapdemo.xyz`.
6. Wait until Cloudflare shows the custom domain as Active.

Important: add the custom domain in the Cloudflare Pages dashboard before creating/using the CNAME as the final endpoint.

## Tests

Health:

```text
GET https://mobileid.nedapdemo.xyz/api/health
```

AEOS provisioning:

```text
POST https://mobileid.nedapdemo.xyz/api/user
Authorization: Basic <aeos-provisioning credentials>
Content-Type: application/json
```

The gateway forwards the Authorization header unchanged to the Supabase Edge Function.
