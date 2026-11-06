# PulseBridge

PulseBridge is a blood donor finder built with plain HTML, CSS and JavaScript, with Supabase for Google sign-in and the database. There is no Node.js, npm or build step.

Signed-in receivers search the public donor directory by blood group, city and state, then send a contact request. Donor phone numbers and emails sit in a separate private table that only admins can read. The admin follows up manually.

## Project layout

```
index.html, login.html, find-donors.html, contact-request.html, admin.html, about.html, privacy.html
pulsebridge-logo.svg
css/style.css
js/supabase-config.js   Supabase URL and publishable key
js/auth.js              Google sign-in, sign-out, page guards, admin check
js/donors.js            Donor search and admin donor management
js/requests.js          Contact requests and the admin request queue
js/ui.js                Shared navigation, footer and helpers
supabase/schema.sql     Tables, security policies and admin functions
```

## Database

| Table | Contents | Who can access |
| --- | --- | --- |
| `donor_directory` | name, age, blood group, city, state, availability | Signed-in users can read. Only admins can change it. |
| `donor_private` | phone, email, consent | Admins only |
| `contact_requests` | requester details, message, urgency, status | Signed-in users can create their own. Admins can read, change status and delete. |
| `admin_emails` | emails of admin accounts | Nobody through the website. Edit it in the Supabase dashboard. |

Extra protections:

- Signed-out visitors cannot read anything.
- A contact request always records the real signed-in user and email, and always starts as `pending`.
- Admins can change only the `status` of a request.
- Each user can send at most 5 contact requests per hour.
- Donor saves and deletes go through admin-only database functions, so the public and private records stay in sync.

## Adding an admin

In Supabase, open the SQL Editor and run:

```sql
insert into public.admin_emails (email) values ('their.email@gmail.com');
```

Use lowercase. The person becomes an admin the next time they load a page.

## Running locally

Google sign-in does not work when the HTML files are opened directly. Run a small local server in the project folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Testing checklist (use fake donors only)

1. As admin: add, edit and delete a donor.
2. As admin: the donor table shows the private phone number.
3. With a second Google account: search for donors and send a contact request.
4. As admin: change that request's status.
5. The second account cannot open the admin page or see any phone numbers.
6. Signed out: the search, request and admin pages send you to sign in.

## Before real donors are added

- Fill in the review date on the Privacy page.
- Add a contact email for donors who want to be removed, and decide how long data is kept.
- Have the consent wording and the site reviewed by a responsible adult or blood donation professional.
- Blood compatibility and eligibility must always be confirmed by qualified medical professionals.
