# WebGenius Admin Panel Flow

## Default Super Admin

The backend seeds roles and one super admin automatically on startup.

Default local credentials:

```env
SUPER_ADMIN_EMAIL=admin@webgenius.local
SUPER_ADMIN_PASSWORD=Admin@12345
SUPER_ADMIN_BYPASS_OTP=true
```

Override these in `backend/.env` before production. If `SUPER_ADMIN_BYPASS_OTP` is not set to `false`, the seeded super admin can log in without email OTP.

## Roles

- `superadmin`: full access, including credit adjustments.
- `admin`: read-only admin analytics access.
- `user`: normal website generation access.

## Credit Flow

### User Signup / Subscription

1. New users receive the free-plan credit grant.
2. A positive `subscription_grant` row is written to `credit_ledger`.
3. When a user upgrades a plan, the plan credit grant is added to their balance.
4. The subscription grant is also written to `credit_ledger`.

### Generation / Edit

1. User starts a generation or edit.
2. Backend calculates fixed internal credit cost.
3. Backend checks `creditsBalance`.
4. A `generation_usage` row is created with `started`.
5. v0 generation/edit runs.
6. On success:
   - website is saved
   - user credits are deducted
   - `credit_ledger` gets a negative `generation` entry
   - `generation_usage` becomes `success`
7. On failure:
   - credits are not deducted
   - `generation_usage` becomes `failed`

## Default Credit Costs

```env
DEFAULT_USER_CREDITS=5
PLAN_CREDITS_FREE=5
PLAN_CREDITS_BASIC=50
PLAN_CREDITS_PREMIUM=200
PLAN_CREDITS_ENTERPRISE=1000
CREDIT_COST_GENERATE_HTML=1
CREDIT_COST_GENERATE_REACT=2
CREDIT_COST_GENERATE_NEXT=3
CREDIT_COST_EDIT=1
CREDIT_COST_IMAGE_REFERENCE=1
```

## Admin Panel

Frontend route:

```text
/admin
```

Admins use a dedicated admin-only layout. `admin` and `superadmin` accounts are redirected to `/admin` after login and are blocked from normal user modules such as Dashboard, History, Profile, and Billing.

Backend routes:

```text
GET  /admin/dashboard
GET  /admin/users
GET  /admin/generations
GET  /admin/ledger
POST /admin/users/:id/credits
```

The panel shows:

- total users and active users
- generation success/failure analytics
- today generation count
- in-progress generation count
- credits consumed, granted, and remaining user credit liability
- net credits and admin adjustments
- subscription credit grants
- image-reference generation count
- average generation duration
- generation mix by status/kind/framework
- users with remaining/used credits
- generation usage logs
- credit ledger history
- recent credit activity

Only `superadmin` can add or remove credits.
