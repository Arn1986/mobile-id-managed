# Account activation

## Flow

1. AEOS calls `POST /api/user` with first name, last name, email and Mobile ID identifier.
2. Unless `sendInvite:false` is explicitly supplied, the backend calls Supabase Auth `inviteUserByEmail`.
3. The user receives an invitation and opens the link.
4. Supabase confirms the email and redirects to `https://mobileid-admin.nedapdemo.xyz/activate.html`.
5. The activation page receives the authenticated invite session and calls `auth.updateUser({ password })`.
6. The page signs the temporary browser session out. The user can then sign in from Android Managed Mode.

## Required Supabase settings

Authentication -> URL Configuration -> Redirect URLs:

```text
https://mobileid-admin.nedapdemo.xyz/activate.html
```

Edge Function secret:

```text
USER_INVITE_REDIRECT_URL=https://mobileid-admin.nedapdemo.xyz/activate.html
```

## Email delivery

For real user addresses configure a custom SMTP provider in Supabase. The built-in provider is only for limited development/testing and may reject addresses that are not members of the Supabase project team.

## Existing pre-v2 users

Users created before this activation flow may be Auth accounts with no password. The admin portal now offers **Resend activation** for pending accounts. If Supabase refuses to re-invite a legacy account, recreate that test user through the new provisioning flow rather than assigning a password through AEOS.
