# Mobile ID Managed

Managed Mobile ID prototype consisting of:

- **Supabase**: Auth, PostgreSQL, Storage, Edge Functions
- **Cloudflare Worker**: clean public API hostname/path for AEOS
- **GitHub Pages**: power-user administration portal
- **Android app**: planned next milestone; receives only per-user `KEYA`, never the reader master key

## Current project endpoints

- Supabase project: `https://gcaqyryxzcphnovgqxhs.supabase.co`
- Planned AEOS API: `https://mobileid.nedapdemo.xyz/api/...`
- Planned admin portal: `https://admin.mobileid.nedapdemo.xyz`

The publishable Supabase key in `admin/config.js` is intentionally public. Do **not** put the Supabase secret key, service-role key, database password, Mobile ID MKEY, AEOS Basic Auth password, GitHub token, or Android signing key into this repository.

## Security model

The reader master key (`MKEY`) exists only as a Supabase Edge Function secret named `MOBILE_ID_MKEY_HEX`. When a logged-in mobile user requests a credential, the backend derives the user's individual `KEYA` from `MKEY + UIDA` and returns only `KEYA`, the UIDA, BLE reader name, badge appearance, and an app-enforced expiry.

The Mobile ID key-diversification implementation is in `supabase/functions/_shared/mobileId.ts` and has been checked against the developer-guide test vector:

- MKEY `8619C154D893C733D2888CE3937AF017`
- UIDA `081122334455667788`
- expected KEYA `B0A42687AA50A67A6DCEB68EA59A1332`

## Repository structure

```text
admin/                         GitHub Pages admin portal
cloudflare/                    API gateway Worker
supabase/migrations/           database schema + RLS
supabase/functions/api/        AEOS Basic Auth REST API
supabase/functions/admin-api/  power-user administration API
supabase/functions/mobile-credential/ Android credential endpoint
supabase/functions/_shared/    shared auth/db/crypto helpers
docs/                          setup and API documentation
.github/workflows/             Pages and optional Supabase deployment
```

## First deployment

Follow [`docs/SETUP.md`](docs/SETUP.md). Do the database migration first, then create the first power-user account and AEOS API client, then deploy the functions, Pages site, and Worker.

## API summary

The public AEOS contract is:

```text
GET    /api/health
POST   /api/user
GET    /api/user/{id-or-externalId}
PUT    /api/user/{id-or-externalId}
DELETE /api/user/{id-or-externalId}   # soft-deactivate
```

All `/api/user...` endpoints use HTTPS Basic Auth. `/api/health` is public.

See [`docs/API.md`](docs/API.md) for examples.
