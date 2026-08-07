# AEOS provisioning API

Base URL after the Cloudflare Worker is deployed:

```text
https://mobileid.nedapdemo.xyz
```

## Authentication

User provisioning endpoints require HTTPS Basic Auth with a dedicated integration account such as `aeos-provisioning`.

Do not put the Basic Auth password in this repository. Create or rotate it in the Supabase SQL editor after the migration has been applied:

```sql
select public.upsert_api_client(
  'aeos-provisioning',
  '<LONG-RANDOM-PASSWORD>',
  'AEOS demo server'
);
```

The database stores only a bcrypt hash of the password.

## Health

```http
GET /api/health
```

Example response:

```json
{
  "success": true,
  "service": "mobile-id-managed",
  "status": "ok",
  "time": "2026-08-07T19:00:00.000Z"
}
```

## Create user

```http
POST /api/user
Authorization: Basic <credentials>
Content-Type: application/json
```

Canonical request:

```json
{
  "externalId": "AEOS-PERSON-123456",
  "firstName": "John",
  "lastName": "Smith",
  "email": "john.smith@example.com",
  "identifierNumber": "081122334455667788"
}
```

For compatibility with the original AEOS idea, lowercase names such as `firstname`, `lastname`, and `identifiernumber` are also accepted.

`identifierNumber` accepts the Mobile ID formats implemented by the reader guide:

- Raw ID64: `08` + 16 hex digits
- Raw ID128: `10` + 32 hex digits
- Wiegand ID: `57` + 28 hex digits

`sendInvite` is optional and defaults to `false`. When `true`, the backend asks Supabase Auth to send an invitation email. Keep it `false` until the user activation/redirect flow is configured.

`overwrite` is optional. When `true`, an existing user with the same `externalId` or email is updated instead of creating a second record. It does not silently steal an identifier assigned to another user.

## Read user

```http
GET /api/user/{profile-uuid-or-externalId}
Authorization: Basic <credentials>
```

## Update user

```http
PUT /api/user/{profile-uuid-or-externalId}
Authorization: Basic <credentials>
Content-Type: application/json
```

Partial updates are accepted:

```json
{
  "identifierNumber": "081122334455667799",
  "active": true
}
```

## Deactivate user

```http
DELETE /api/user/{profile-uuid-or-externalId}
Authorization: Basic <credentials>
```

This is a **soft deactivation**. The Supabase Auth account and historical audit records remain. The mobile credential endpoint refuses to issue a credential while the profile is inactive.

## Status codes

- `200` successful read/update/deactivate
- `201` user created
- `400` malformed or invalid input
- `401` missing/invalid Basic Auth
- `404` endpoint or user not found
- `409` duplicate/conflicting email, identifier, or external ID
- `415` non-JSON body where JSON is required
- `500` unexpected server error

Errors have a stable shape:

```json
{
  "success": false,
  "error": {
    "code": "user_conflict",
    "message": "A user already exists with this email, identifier, or externalId"
  }
}
```

## curl examples

```bash
curl https://mobileid.nedapdemo.xyz/api/health
```

```bash
curl -X POST \
  https://mobileid.nedapdemo.xyz/api/user \
  -u 'aeos-provisioning:YOUR_PASSWORD' \
  -H 'Content-Type: application/json' \
  -d '{
    "externalId":"AEOS-PERSON-123456",
    "firstName":"John",
    "lastName":"Smith",
    "email":"john.smith@example.com",
    "identifierNumber":"081122334455667788"
  }'
```
