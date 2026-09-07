# Paystack escrow functions

Three functions. The split is not decoration: `initialize` is the only
place the amount is decided, `verify` is the only place the app can mark
anything paid, and `webhook` is what makes the whole thing survive a
buyer closing the tab.

## Secrets

```bash
supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_xxx \
  PAYSTACK_ALLOWED_CALLBACKS=http://localhost:8081,https://your-domain.pages.dev,loci://
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set them.

The **secret** key belongs only here. The **public** key
(`EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY`) is the only Paystack value that may
appear in the app's `.env`, because everything named `EXPO_PUBLIC_*` is
compiled into the JavaScript every visitor downloads.

## Deploy

```bash
supabase functions deploy paystack-initialize
supabase functions deploy paystack-verify
supabase functions deploy paystack-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook only. Paystack has no Supabase token, so
the HMAC signature check in `_shared/paystack.ts` is that endpoint's
entire authentication.

## Paystack dashboard

Settings → API Keys & Webhooks → Webhook URL:

```
https://<project-ref>.supabase.co/functions/v1/paystack-webhook
```

## Test cards

Paystack's test cards are at https://paystack.com/docs/payments/test-payments.
`4084 0840 8408 4081`, any future expiry, any CVV, OTP `123456`.
