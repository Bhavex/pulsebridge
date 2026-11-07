import json, uuid, sys
import psycopg2

conn = psycopg2.connect(host="/var/tmp/pbpg", port=5499, user="postgres", dbname="pb")
conn.autocommit = True
cur = conn.cursor()

U = {k: str(uuid.uuid4()) for k in ["admin", "d1", "d2", "r", "s", "b"]}
EMAIL = {k: f"{k}@example.com" for k in U}
for k in U:
    cur.execute("insert into auth.users (id, email) values (%s, %s)", (U[k], EMAIL[k]))
cur.execute("insert into public.admin_emails (email) values ('admin@example.com')")

passed, failed = 0, []

def as_user(who):
    cur.execute("reset role")
    if who == "anon":
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"role": "anon"}),))
        cur.execute("set role anon")
    elif who == "service":
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"role": "service_role"}),))
        cur.execute("set role service_role")
    else:
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": U[who], "email": EMAIL[who], "role": "authenticated"}),))
        cur.execute("set role authenticated")

def run(who, sql, args=()):
    as_user(who)
    try:
        cur.execute(sql, args)
        rows = cur.fetchall() if cur.description else []
        return rows, None
    except Exception as e:
        return None, str(e).splitlines()[0]
    finally:
        cur.execute("reset role")

def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name} :: {detail}")

def expect_ok(name, who, sql, args=()):
    rows, err = run(who, sql, args)
    ok(name, err is None, err)
    return rows

def expect_err(name, who, sql, args=(), contains=None):
    rows, err = run(who, sql, args)
    ok(name, err is not None and (contains is None or contains.lower() in err.lower()), err or f"no error, rows={rows}")

SAVE = "select public.save_my_donor_profile(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"

for t in ["donor_directory", "donor_private", "contact_requests", "admin_emails", "blocked_users", "availability_tokens", "contact_reveals", "search_log"]:
    expect_err(f"anon cannot read {t}", "anon", f"select * from public.{t}", contains="permission denied")
    expect_err(f"signed-in cannot read {t}", "s", f"select * from public.{t}", contains="permission denied")
expect_err("signed-in cannot insert directory", "s", "insert into public.donor_directory (name, age, blood_group, city, state) values ('x',20,'O+','a','b')", contains="permission denied")
expect_err("signed-in cannot insert request directly", "s", "insert into public.contact_requests (donor_id, requester_name, requester_phone, message, urgency) values (gen_random_uuid(),'a','9999999999','m','routine')", contains="permission denied")
expect_err("anon cannot search", "anon", "select * from public.search_donors('O+')", contains="permission denied")
expect_err("anon cannot save donor", "anon", SAVE, ("A", 20, "O+", "9876543210", "Pune", "MH", "Ruby Hall", None, "", True), contains="permission denied")
expect_err("authenticated cannot issue reminders", "s", "select * from public.issue_availability_reminders(10)", contains="permission denied")
expect_err("authenticated cannot call require_user", "s", "select public.require_user()", contains="permission denied")

expect_err("underage donor rejected", "d1", SAVE, ("Asha Rao", 17, "O-", "9876543210", "Pune", "Maharashtra", "Ruby Hall Clinic", None, "", True), contains="between 18")
expect_err("bad phone rejected", "d1", SAVE, ("Asha Rao", 25, "O-", "abc", "Pune", "Maharashtra", "Ruby Hall Clinic", None, "", True), contains="phone")
expect_err("no consent rejected", "d1", SAVE, ("Asha Rao", 25, "O-", "9876543210", "Pune", "Maharashtra", "Ruby Hall Clinic", None, "", False), contains="consent")
expect_err("future donation date rejected", "d1", SAVE, ("Asha Rao", 25, "O-", "9876543210", "Pune", "Maharashtra", "Ruby Hall Clinic", "2099-01-01", "", True), contains="last donation")
d1 = expect_ok("donor 1 registers", "d1", SAVE, ("Asha Rao", 25, "O-", "+91 98765 43210", "Pune", "Maharashtra", "Ruby Hall Clinic", "2026-01-10", "REG-123", True))[0][0]
d1b = expect_ok("donor 1 re-saves same row", "d1", SAVE, ("Asha Rao", 26, "O-", "+91 98765 43210", "Pune", "Maharashtra", "Ruby Hall Clinic", "2026-01-10", "REG-123", True))[0][0]
ok("re-save keeps one profile", d1 == d1b)
d2 = expect_ok("donor 2 registers", "d2", SAVE, ("Vikram", 40, "A+", "9123456789", "Pune", "Maharashtra", "Jehangir Hospital", None, None, True))[0][0]
prof = expect_ok("donor reads own profile", "d1", "select phone, registration_number, age from public.get_my_donor_profile()")
ok("own profile has phone", prof and prof[0][0] == "+91 98765 43210", prof)
other = expect_ok("stranger profile empty", "s", "select * from public.get_my_donor_profile()")
ok("stranger sees no profile", other == [], other)

res = expect_ok("recipient search A+ with compatible", "r", "select display_name, blood_group, hospital, eligible_now, exact_match from public.search_donors('A+', true, 'pune', null, null, 'best')")
names = sorted(r[0] for r in res or [])
ok("compatible search finds both", names == ["Asha R.", "Vikram"], res)
ok("exact match sorted first", res and res[0][1] == "A+", res)
cols = expect_ok("search columns", "r", "select * from public.search_donors('O-', false, null, null, null, 'best') limit 1")
as_user("r"); cur.execute("select * from public.search_donors('O-') limit 0"); colnames = [d[0] for d in cur.description]; cur.execute("reset role")
ok("search exposes no phone/email/full name", not any(c in colnames for c in ["phone", "email", "name", "user_id", "registration_number"]), colnames)
res = expect_ok("hospital filter", "r", "select display_name from public.search_donors(null, false, null, null, 'jehangir', 'hospital')")
ok("hospital filter works", [r[0] for r in res or []] == ["Vikram"], res)
res = expect_ok("wildcard injection harmless", "r", "select count(*) from public.search_donors(null, false, null, null, %s, 'city')", ('%',))
ok("percent sign is literal", res and res[0][0] == 0, res)
res = expect_ok("donor does not see self", "d1", "select display_name from public.search_donors(null)")
ok("self excluded", [r[0] for r in res or []] == ["Vikram"], res)

slip_r = f"{U['r']}/slip1.jpg"
expect_err("upload into someone else's folder blocked", "r", "insert into storage.objects (bucket_id, name) values ('requisition-slips', %s)", (f"{U['s']}/x.jpg",), contains="row-level security")
expect_ok("recipient uploads own slip", "r", "insert into storage.objects (bucket_id, name) values ('requisition-slips', %s)", (slip_r,))
CREATE = "select public.create_blood_request(%s,%s,%s,%s,%s,%s,current_date + 2,%s,%s,%s,%s,%s)"
expect_err("request without slip", "r", CREATE, (d1, "Patient P", "A+", 2, "KEM", "Pune", "Rita", "9000000001", "urgent", "", None), contains="slip")
expect_err("request with other's slip path", "r", CREATE, (d1, "Patient P", "A+", 2, "KEM", "Pune", "Rita", "9000000001", "urgent", "", f"{U['s']}/x.jpg"), contains="slip")
expect_err("incompatible donor rejected", "r", CREATE, (d2, "Patient P", "O-", 2, "KEM", "Pune", "Rita", "9000000001", "urgent", "", slip_r), contains="compatible")
req = expect_ok("recipient creates request", "r", CREATE, (d1, "Patient P", "A+", 2, "KEM", "Pune", "Rita Shah", "9000000001", "urgent", "Surgery tomorrow", slip_r))[0][0]
expect_err("duplicate open request blocked", "r", CREATE, (d1, "Patient P", "A+", 2, "KEM", "Pune", "Rita", "9000000001", "urgent", "", slip_r), contains="already")
expect_err("self request blocked", "d1", CREATE, (d1, "Patient P", "A+", 2, "KEM", "Pune", "Asha", "9000000001", "urgent", "", slip_r))

expect_err("recipient cannot see contact while pending", "r", "select * from public.get_request_contact(%s)", (req,), contains="only after")
expect_err("donor cannot see contact while pending", "d1", "select * from public.get_request_contact(%s)", (req,), contains="only after")
mine = expect_ok("recipient lists own requests", "r", "select status, donor_display_name from public.my_requests()")
ok("my_requests shows pending with masked donor", mine == [("pending", "Asha R.")], mine)
inc = expect_ok("donor 1 sees incoming", "d1", "select status, slip_path, requester_name from public.incoming_requests()")
ok("incoming has slip path", inc and inc[0][1] == slip_r, inc)
inc2 = expect_ok("donor 2 sees none", "d2", "select * from public.incoming_requests()")
ok("other donor sees no request", inc2 == [], inc2)
seen = expect_ok("donor 1 can read slip", "d1", "select name from storage.objects where bucket_id='requisition-slips'")
ok("matched donor sees slip", seen == [(slip_r,)], seen)
seen = expect_ok("donor 2 cannot read slip", "d2", "select name from storage.objects where bucket_id='requisition-slips'")
ok("unmatched donor sees no slip", seen == [], seen)
seen = expect_ok("stranger cannot read slip", "s", "select name from storage.objects where bucket_id='requisition-slips'")
ok("stranger sees no slip", seen == [], seen)
seen = expect_ok("admin can read slip", "admin", "select name from storage.objects where bucket_id='requisition-slips'")
ok("admin sees slip", seen == [(slip_r,)], seen)

expect_err("stranger cannot accept", "s", "select public.respond_to_request(%s, true)", (req,), contains="no longer")
expect_err("recipient cannot accept own", "r", "select public.respond_to_request(%s, true)", (req,), contains="no longer")
expect_ok("donor accepts", "d1", "select public.respond_to_request(%s, true)", (req,))
expect_err("cannot answer twice", "d1", "select public.respond_to_request(%s, false)", (req,), contains="no longer")
c = expect_ok("recipient gets donor contact", "r", "select * from public.get_request_contact(%s)", (req,))
ok("recipient sees donor phone", c == [("Asha Rao", "+91 98765 43210", "donor")], c)
c = expect_ok("donor gets recipient contact", "d1", "select * from public.get_request_contact(%s)", (req,))
ok("donor sees recipient phone", c == [("Rita Shah", "9000000001", "recipient")], c)
expect_err("stranger cannot get contact", "s", "select * from public.get_request_contact(%s)", (req,), contains="only after")
expect_err("donor 2 cannot get contact", "d2", "select * from public.get_request_contact(%s)", (req,), contains="only after")
cur.execute("select count(*) from public.contact_reveals where request_id = %s", (req,))
ok("contact reveals are logged", cur.fetchone()[0] == 2)
expect_ok("recipient marks done", "r", "select public.complete_my_request(%s)", (req,))
expect_err("contact hidden after completion", "r", "select * from public.get_request_contact(%s)", (req,))

expect_ok("donor pauses", "d1", "select public.set_my_availability(false)")
res = expect_ok("search after pause", "r", "select display_name from public.search_donors(null)")
ok("paused donor hidden", [r[0] for r in res or []] == ["Vikram"], res)
expect_ok("donor resumes", "d1", "select public.set_my_availability(true)")
cur.execute("update public.donor_directory set availability_confirmed_at = now() - interval '40 days' where id = %s", (d2,))
res = expect_ok("search after expiry", "r", "select display_name from public.search_donors(null)")
ok("unconfirmed donor auto-hidden", [r[0] for r in res or []] == ["Asha R."], res)

toks = expect_ok("service issues reminders", "service", "select donor_id, email, first_name, token from public.issue_availability_reminders(10)")
ok("reminder for stale donor only", toks and len(toks) == 1 and str(toks[0][0]) == d2 and toks[0][1] == "d2@example.com", toks)
again = expect_ok("no duplicate reminders", "service", "select * from public.issue_availability_reminders(10)")
ok("reminder not re-sent immediately", again == [], again)
tok = toks[0][3] if toks else ""
expect_err("bad token rejected", "anon", "select public.confirm_availability_token(%s)", ("0" * 64,), contains="expired")
r1 = expect_ok("anon confirms with token", "anon", "select public.confirm_availability_token(%s)", (tok,))
ok("confirm returns first name", r1 == [("Vikram",)], r1)
expect_err("token single-use", "anon", "select public.confirm_availability_token(%s)", (tok,), contains="already used")
res = expect_ok("search after confirm", "r", "select count(*) from public.search_donors(null)")
ok("confirmed donor visible again", res == [(2,)], res)

slip_s = f"{U['s']}/s.jpg"
expect_ok("stranger uploads slip", "s", "insert into storage.objects (bucket_id, name) values ('requisition-slips', %s)", (slip_s,))
req2 = expect_ok("stranger requests donor 2", "s", CREATE, (d2, "P2", "AB+", 1, "Sassoon", "Pune", "Sam", "9000000002", "soon", "", slip_s))[0][0]
expect_ok("donor 2 reports request", "d2", "select public.report_request(%s, 'Fake slip')", (req2,))
mine = expect_ok("reporter outcome hidden from requester", "s", "select status from public.my_requests()")
ok("reported shows as declined to requester", mine == [("declined",)], mine)

expect_err("non-admin list donors", "r", "select * from public.admin_list_donors()", contains="admin")
expect_err("non-admin list requests", "r", "select * from public.admin_list_requests()", contains="admin")
expect_err("non-admin block", "r", "select public.admin_block_user(%s, 'x')", (U["s"],), contains="admin")
rows = expect_ok("admin lists donors", "admin", "select name, phone from public.admin_list_donors()")
ok("admin sees phones", rows and all(r[1] for r in rows), rows)
rows = expect_ok("admin lists requests", "admin", "select status from public.admin_list_requests()")
ok("reported first for admin", rows and rows[0][0] == "reported", rows)
expect_ok("admin blocks stranger", "admin", "select public.admin_block_user(%s, 'Fake requests')", (U["s"],))
expect_err("blocked user cannot search", "s", "select * from public.search_donors(null)", contains="blocked")
expect_err("blocked user cannot upload", "s", "insert into storage.objects (bucket_id, name) values ('requisition-slips', %s)", (f"{U['s']}/t.jpg",), contains="row-level security")
expect_ok("admin unblocks", "admin", "select public.admin_unblock_user(%s)", (U["s"],))
expect_ok("unblocked can search", "s", "select * from public.search_donors(null)")

cur.execute("delete from public.search_log")
for i in range(40):
    run("r", "select * from public.search_donors(null)")
expect_err("search rate limit", "r", "select * from public.search_donors(null)", contains="too many")

cur.execute("update public.contact_requests set status='pending', created_at = now() - interval '80 hours' where id = %s", (req2,))
rows = expect_ok("stale pending expires", "admin", "select status from public.admin_list_requests() where id = %s", (req2,))
ok("72h pending becomes expired", rows == [("expired",)], rows)

expect_ok("donor deletes profile", "d1", "select public.delete_my_donor_profile()")
cur.execute("select count(*) from public.donor_directory where id = %s", (d1,))
ok("profile gone", cur.fetchone()[0] == 0)
cur.execute("select count(*) from public.donor_private where donor_id = %s", (d1,))
ok("private data gone", cur.fetchone()[0] == 0)


expect_ok("anon can log a client error", "anon", "select public.log_client_error('index.html', 'boom', 'stack', 'ua')")
expect_err("anon cannot read client errors", "anon", "select * from public.client_errors", contains="permission denied")
expect_err("signed-in cannot read client errors", "r", "select * from public.client_errors", contains="permission denied")
expect_err("non-admin cannot list errors", "r", "select * from public.admin_list_errors()", contains="admin")
expect_err("non-admin cannot export backup", "r", "select public.admin_export_backup()", contains="admin")
expect_err("anon cannot export backup", "anon", "select public.admin_export_backup()", contains="permission denied")
rows = expect_ok("admin lists errors", "admin", "select message from public.admin_list_errors()")
ok("logged error visible to admin", rows and rows[0][0] == "boom", rows)
rows = expect_ok("admin exports backup", "admin", "select jsonb_array_length(public.admin_export_backup() -> 'donor_private')")
ok("backup includes private donor rows", rows and rows[0][0] >= 1, rows)
expect_ok("admin clears errors", "admin", "select public.admin_clear_errors()")

print(f"PASSED {passed}  FAILED {len(failed)}")
for f in failed:
    print("FAIL", f)
sys.exit(1 if failed else 0)
