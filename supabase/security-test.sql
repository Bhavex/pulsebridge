do $$
declare
  a uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  d uuid;
  n int;
  r text := '';
  t text;
  rid uuid;
begin
  insert into auth.users (id, email, aud, role) values (a, 'admin@test.dev', 'authenticated', 'authenticated'), (u, 'user@test.dev', 'authenticated', 'authenticated');
  insert into public.admin_emails values ('admin@test.dev');

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'email', 'admin@test.dev', 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || 'admin is_admin=' || public.is_admin() || ' | ';
  d := public.admin_save_donor(null, ' Test Donor ', 25, 'O+', ' Pune ', 'Maharashtra', true, '999', 'd@x.dev', true);
  select count(*) into n from public.donor_private; r := r || 'admin private rows=' || n || ' | ';
  perform public.admin_save_donor(d, 'Test Donor', 26, 'O+', 'Pune', 'Maharashtra', false, '888', '', true);
  select age || '/' || city_lower into t from public.donor_directory where id = d; r := r || 'after edit=' || t || ' | ';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'email', 'user@test.dev', 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || 'user is_admin=' || public.is_admin() || ' | ';
  select count(*) into n from public.donor_directory where blood_group = 'O+' and city_lower = 'pune'; r := r || 'user search rows=' || n || ' | ';
  select count(*) into n from public.donor_private; r := r || 'user private rows=' || n || ' | ';
  insert into public.contact_requests (donor_id, requester_name, requester_phone, message, urgency) values (d, 'Recv', '111', 'help', 'urgent');
  r := r || 'user request ok | ';
  select count(*) into n from public.contact_requests; r := r || 'user reads requests=' || n || ' | ';
  update public.contact_requests set status = 'completed'; get diagnostics n = row_count; r := r || 'user status change rows=' || n || ' | ';
  begin perform public.admin_save_donor(null, 'X', 30, 'A+', 'a', 'b', true, '1', '', true); r := r || 'user save ALLOWED (BAD) | ';
  exception when others then r := r || 'user save blocked | '; end;
  begin insert into public.contact_requests (donor_id, requester_name, requester_phone, message, urgency, status) values (d, 'R', '1', 'm', 'soon', 'completed'); r := r || 'status spoof ALLOWED (BAD) | ';
  exception when others then r := r || 'status spoof blocked | '; end;
  begin insert into public.contact_requests (donor_id, requester_name, requester_phone, message, urgency, requester_uid) values (d, 'R', '1', 'm', 'soon', a); r := r || 'uid spoof ALLOWED (BAD) | ';
  exception when others then r := r || 'uid spoof blocked | '; end;
  begin
    for i in 1..5 loop insert into public.contact_requests (donor_id, requester_name, requester_phone, message, urgency) values (d, 'R', '1', 'm', 'soon'); end loop;
    r := r || 'rate limit NOT hit (BAD) | ';
  exception when others then r := r || 'rate limit hit | '; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'email', 'admin@test.dev', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(requester_email) into n, t from public.contact_requests; r := r || 'admin reads requests=' || n || ' from ' || t || ' | ';
  select id into rid from public.contact_requests limit 1;
  update public.contact_requests set status = 'contacted' where id = rid; get diagnostics n = row_count; r := r || 'admin status change rows=' || n || ' | ';
  begin update public.contact_requests set message = 'changed' where id = rid; r := r || 'admin message edit ALLOWED (BAD) | ';
  exception when others then r := r || 'admin message edit blocked | '; end;
  perform public.admin_delete_donor(d);
  select count(*) into n from public.donor_private; r := r || 'after delete private=' || n || ' | ';
  select count(*) into n from public.contact_requests; r := r || 'after delete requests=' || n || ' | ';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin select count(*) into n from public.donor_directory; r := r || 'signed-out read ALLOWED (BAD) | ';
  exception when others then r := r || 'signed-out read blocked | '; end;
  reset role;

  raise exception 'TEST RESULTS (nothing was saved): %', r;
end;
$$;
