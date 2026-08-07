# Initial setup

This project is already configured with:

```text
Supabase project ref: gcaqyryxzcphnovgqxhs
Supabase URL:         https://gcaqyryxzcphnovgqxhs.supabase.co
GitHub repository:    Arn1986/mobile-id-managed
```

The publishable key is already present in `admin/config.js`. It is a client-facing value and is not a privileged credential.

## 1. Put this source into GitHub

Copy the contents of this package into your `mobile-id-managed` repository, then commit and push to `main`.

Example:

```bash
git add .
git commit -m "initial managed Mobile ID backend and admin portal"
git push origin main
```

## 2. Apply the Supabase migration

Install the Supabase CLI, log in, link the project, and push the migration:

```bash
supabase login
supabase link --project-ref gcaqyryxzcphnovgqxhs
supabase db push
```

Once migration-based development starts, make future schema changes as new files under `supabase/migrations/` instead of changing the remote schema ad hoc.

## 3. Configure the Mobile ID master key securely

Set the actual reader MKEY as an Edge Function secret. Do not put it in GitHub, the admin page, or the Android app.

```bash
supabase secrets set MOBILE_ID_MKEY_HEX=<32-HEX-CHARACTER-MKEY> --project-ref gcaqyryxzcphnovgqxhs
```

Optional secrets:

```bash
supabase secrets set \
  ADMIN_ALLOWED_ORIGINS=https://admin.mobileid.nedapdemo.xyz,https://arn1986.github.io \
  USER_INVITE_REDIRECT_URL=https://admin.mobileid.nedapdemo.xyz/ \
  --project-ref gcaqyryxzcphnovgqxhs
```

Do not enable `sendInvite` for end users yet unless you have decided where invitation links should land and how users set their first password.

## 4. Deploy Supabase Edge Functions

```bash
supabase functions deploy --project-ref gcaqyryxzcphnovgqxhs
```

The functions are:

```text
api                AEOS Basic Auth provisioning API
admin-api          power-user operations for the GitHub Pages portal
mobile-credential  signed-in Android credential endpoint
```

`api` and `admin-api` perform their own authentication in code and therefore have `verify_jwt = false`. `mobile-credential` requires a normal Supabase user JWT.

## 5. Create the first power user

In Supabase Dashboard, create an Auth user with your administrator email and password:

```text
Authentication -> Users -> Add user
```

Then open the SQL editor and run:

```sql
select public.bootstrap_power_user(
  'your-admin-email@example.com',
  'Your',
  'Name',
  'power_user'
);
```

The admin website never needs a Supabase secret/service key. It signs in normally and the server checks that the profile role is `power_user` or `admin`.

## 6. Create the AEOS Basic Auth identity

Generate a long random password locally, keep it in the AEOS/server secret store, and run this once in the Supabase SQL editor:

```sql
select public.upsert_api_client(
  'aeos-provisioning',
  '<AT-LEAST-20-CHARACTER-RANDOM-PASSWORD>',
  'AEOS provisioning'
);
```

To rotate the password, call the same function again with a new password. Only its bcrypt hash is stored.

## 7. Test Supabase directly before Cloudflare

Health endpoint:

```bash
curl https://gcaqyryxzcphnovgqxhs.supabase.co/functions/v1/api/health
```

Create user:

```bash
curl -X POST \
  https://gcaqyryxzcphnovgqxhs.supabase.co/functions/v1/api/user \
  -u 'aeos-provisioning:YOUR_PASSWORD' \
  -H 'Content-Type: application/json' \
  -d '{
    "externalId":"AEOS-TEST-001",
    "firstName":"Test",
    "lastName":"User",
    "email":"test.user@example.com",
    "identifierNumber":"081122334455667788"
  }'
```

Do this direct test first. It separates Supabase/API problems from Cloudflare/DNS problems.

## 8. Enable the GitHub Pages admin portal

The workflow `.github/workflows/deploy-pages.yml` publishes the `admin/` directory.

In GitHub:

```text
Repository -> Settings -> Pages -> Source -> GitHub Actions
```

Then configure the custom domain:

```text
admin.mobileid.nedapdemo.xyz
```

The `admin/CNAME` file is included, but the custom domain should still be configured in the GitHub Pages settings.

After DNS/TLS has settled, sign in at the Pages site with the power-user account from step 5.

## 9. Deploy the Cloudflare Worker

Your `nedapdemo.xyz` DNS zone must be active in Cloudflare for a Worker Custom Domain.

From the `cloudflare/` directory:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

`cloudflare/wrangler.toml` maps the Worker to:

```text
mobileid.nedapdemo.xyz
```

and proxies:

```text
/api/*
```

to the Supabase `api` function. Basic Auth is preserved end-to-end; the Supabase function performs the actual credential verification.

After deployment:

```bash
curl https://mobileid.nedapdemo.xyz/api/health
```

## 10. Optional GitHub Actions for Supabase

The included Supabase deployment workflow is manual by default. If you want to use it, add these GitHub repository secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Never add those values to source files.

## Next milestone

After the backend and admin portal are confirmed working, modify the Android Demo v8 application to add **Demo / Managed** mode. Managed mode will:

1. sign in with email/password,
2. call `mobile-credential`,
3. receive UIDA + per-user KEYA + BLE reader name + badge configuration,
4. cache that credential using Android Keystore,
5. enforce the returned expiry locally,
6. use the already-working Mobile ID BLE authentication flow.

The Android client will never receive the global MKEY.
