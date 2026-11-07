# PulseBridge

PulseBridge is a blood donor finder built with plain HTML, CSS and JavaScript, with Supabase for Google sign-in, the database and file storage. There is no build step. It also installs as an app on phones (PWA).

## How it works

**Recipients** sign in with Google, search donors by blood group (optionally including compatible groups), city, state and nearby hospital, and sort by best match, hospital, city, most recently confirmed or age. They send a request with the patient's details and a photo or PDF of the hospital's blood requisition slip.

**Donors** sign in and register themselves: name, age, blood group, phone, nearby hospital, city, state, and optionally their last donation date and donation registration number. They see each request with its slip and choose **Accept**, **I can't help** or **Report as fake**.

**Contact sharing:** when a donor accepts, the recipient sees the donor's phone number under My requests and the donor sees the recipient's number. Nobody else ever does. Pending requests expire after 72 hours.

**Monthly check:** every 30 days donors get an email with a one-tap "Yes, I'm still available" link. Donors who haven't confirmed within 37 days are hidden from search until they confirm.

## Security model

All data access goes through database functions. Signed-in users cannot read any table directly.

- Search returns only first name + last initial, age, blood group, city, state, hospital and eligibility. Never phone, email, full name or registration number.
- Search is limited to 40 per hour per account. Requests are limited to 5 per hour and 15 per day.
- Phone numbers are released only by `get_request_contact`, only for accepted requests, only to the two people involved, and every view is logged.
- Hospital slips live in a private storage bucket. Only the uploader, the donor the request was sent to (while it's open) and admins can open them, through 2-minute signed links.
- Donors can report requests. Admins can block accounts; blocked accounts can't search, upload or request.
- Pages ship a strict Content Security Policy and load the Supabase library from this repo, not a CDN.

The database rules are tested by `supabase/tests/test_security.py` (121 checks).

## Setup (one time)

1. **Run the database migration.** In Supabase, open SQL Editor, paste all of `supabase/migrations/002_donor_portal.sql` and run it. It's safe to run more than once. If this is a brand-new project, run `supabase/schema.sql` first.
2. **Google sign-in.** Authentication → Providers → Google must be on. Under Authentication → URL Configuration add `https://bhavex.github.io/pulsebridge/` and `http://localhost:8000` as redirect URLs.
3. **Add an admin.** In SQL Editor: `insert into public.admin_emails (email) values ('your.email@gmail.com');` (lowercase).
4. **Monthly emails** (can be done later):
   - Create a free account at resend.com and get an API key.
   - Deploy the function: `supabase functions deploy monthly-availability --no-verify-jwt`
   - Set secrets: `supabase secrets set RESEND_API_KEY=... CRON_SECRET=<long random text> SITE_URL=https://bhavex.github.io/pulsebridge EMAIL_FROM="PulseBridge <you@yourdomain>"`
   - Open `supabase/cron/monthly_availability.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`, and run it in SQL Editor. It runs daily at 10:00 IST and emails only donors who are due.

## Running locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Testing the database rules locally

Needs PostgreSQL 15+ and `pip install psycopg2-binary`:

```
createdb pb
psql -d pb -f supabase/tests/local_supabase_stubs.sql
psql -d pb -f supabase/schema.sql
psql -d pb -f supabase/migrations/002_donor_portal.sql
python3 supabase/tests/test_security.py
```

Edit the connection line at the top of the test file to match your database.

## Before real donors are added

- Fill in the review date and a contact email on the Privacy page.
- Have the consent wording and the site reviewed by a blood bank or medical professional.
- Blood compatibility and eligibility must always be confirmed by the hospital or blood bank.
